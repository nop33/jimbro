import { QUEUE_STORES, queueRows } from '../sync/queue'
import { announce } from '../sync/pageChannel'
import { DB_NAME, OBJECT_STORES } from './constants'
import { DB_VERSION, upgradeDatabase } from './migrations'
import { promisifyRequest } from './promisifyRequest'
import type { Row, RowTable, SetRow } from './types'

export const STORE_FOR_TABLE: Record<RowTable, string> = {
  exercises: OBJECT_STORES.EXERCISES,
  programs: OBJECT_STORES.PROGRAMS,
  sessions: OBJECT_STORES.WORKOUT_SESSIONS,
  sets: OBJECT_STORES.SETS
}

export const cloneForIdb = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T

export const putRow = (tx: IDBTransaction, row: Row) => {
  tx.objectStore(STORE_FOR_TABLE[row.table]).put(cloneForIdb(row.row))
}

// setGroups caches each session's set rows, so reading every session takes one record per session instead of one per
// set, which measured about twice as fast. It holds the same rows as the sets store, so every transaction that writes
// or deletes set rows updates it here, in that transaction: writeRows, and the first sync's commit.
export const updateSetGroups = (
  tx: IDBTransaction,
  written: ReadonlyArray<SetRow>,
  deleted: ReadonlyMap<string, ReadonlyArray<SetRow['id']>> = new Map()
) => {
  const sessions = new Set([...deleted.keys(), ...written.map((set) => set.sessionId)])
  const groupStore = tx.objectStore(OBJECT_STORES.SET_GROUPS)
  for (const sessionId of sessions) {
    const request = groupStore.get(sessionId)
    request.onsuccess = () => {
      const drop = new Set(deleted.get(sessionId) ?? [])
      const current = ((request.result?.sets ?? []) as Array<SetRow>).filter((set) => !drop.has(set.id))
      const merged = new Map(current.map((set) => [set.id, set]))
      for (const set of written) {
        if (set.sessionId === sessionId) merged.set(set.id, cloneForIdb(set))
      }
      groupStore.put({ sessionId, sets: [...merged.values()] })
    }
  }
}

if (navigator.storage && navigator.storage.persist) {
  // Nothing waits for the answer, since the browser may ask the user first.
  void navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log('Storage will not be cleared except by explicit user action')
    } else {
      console.log('Storage may be cleared by the UA under storage pressure.')
    }
  })
}

const openDatabase = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onsuccess = (event) => {
      console.log('✅ Opened DB connection', event)
      resolve(request.result)
    }

    request.onerror = (event) => {
      console.error('❌ Could not open DB connection', event)
      reject(request.error)
    }

    request.onupgradeneeded = (event) => upgradeDatabase(request.result, event.oldVersion)
  })
}

// The one shared IndexedDB connection, the generic reads, and writeRows, the one write path for local edits.
// The sync's own transactions live in src/sync.
export class Storage {
  private db: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null

  async connection(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (!this.opening) {
      this.opening = openDatabase().then((db) => {
        // Another page is deleting or upgrading the database. Pages in the back/forward cache hold a connection too,
        // and nobody can close those by hand, so every connection steps aside, and the next read opens a new one.
        db.onversionchange = () => {
          db.close()
          this.forget(db)
        }
        // The browser closed the connection itself, as when the user clears site data or the database process goes
        // away while an installed app sits in the background. The next read or write opens a new one.
        db.onclose = () => this.forget(db)
        this.db = db
        return db
      })
      // A failed open is not kept, so the next call tries again.
      this.opening.catch(() => {
        this.opening = null
      })
    }
    return this.opening
  }

  private forget(db: IDBDatabase) {
    if (this.db !== db) return
    this.db = null
    this.opening = null
  }

  // A transaction on the shared connection. A connection that closed under the page refuses new transactions with
  // InvalidStateError, without always firing close first, so the transaction opens again on a new connection.
  async transaction(storeNames: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    const db = await this.connection()
    let tx: IDBTransaction
    try {
      tx = db.transaction(storeNames, mode)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error
      this.forget(db)
      tx = (await this.connection()).transaction(storeNames, mode)
    }
    tx.addEventListener('abort', () => this.dropIfLost(tx))
    return tx
  }

  // A transaction that failed because the connection went (Safari reports "Connection to Indexed Database server
  // lost" as an UnknownError) leaves the connection unusable, so the next one opens a new connection.
  private dropIfLost(tx: IDBTransaction) {
    const name = tx.error?.name
    if (name === 'UnknownError' || name === 'InvalidStateError') this.forget(tx.db)
  }

  // Stores the rows, queues each one for the next push and updates setGroups, all in one transaction.
  async writeRows(writes: Array<Row>): Promise<void> {
    if (writes.length === 0) return
    const storeNames = [...new Set(writes.map((write) => STORE_FOR_TABLE[write.table]))]
    storeNames.push(...QUEUE_STORES)
    const setWrites = writes.filter((write): write is { table: 'sets'; row: SetRow } => write.table === 'sets')
    if (setWrites.length > 0) storeNames.push(OBJECT_STORES.SET_GROUPS)
    const tx = await this.transaction(storeNames, 'readwrite')
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        try {
          tx.abort()
        } catch {
          // The transaction already finished.
        }
        reject(error)
      }
      tx.oncomplete = () => {
        if (settled) return
        settled = true
        resolve()
      }
      tx.onerror = () => fail(tx.error ?? new Error('writeRows failed'))
      tx.onabort = () => fail(tx.error ?? new Error('writeRows aborted'))
      try {
        for (const write of writes) putRow(tx, write)
        if (setWrites.length > 0)
          updateSetGroups(
            tx,
            setWrites.map((write) => write.row)
          )
        queueRows(tx, writes)
      } catch (error) {
        fail(error)
      }
    })
    announce('rows-written')
  }

  private async getStore(storeName: string): Promise<IDBObjectStore> {
    const tx = await this.transaction([storeName], 'readonly')
    return tx.objectStore(storeName)
  }

  async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    return promisifyRequest<T | undefined>(store.get(key))
  }

  async getAllByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<Array<T>> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return promisifyRequest(index.getAll(key))
  }

  async getFirstByPredicate<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection,
    predicate: (value: T) => boolean
  ): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, direction)
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          if (predicate(cursor.value as T)) {
            resolve(cursor.value as T)
          } else {
            cursor.continue()
          }
        } else {
          resolve(undefined)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getAll<T>(storeName: string): Promise<Array<T>> {
    const store = await this.getStore(storeName)
    return promisifyRequest(store.getAll())
  }

  async count(storeName: string): Promise<number> {
    const store = await this.getStore(storeName)
    return promisifyRequest(store.count())
  }

  async deleteDatabase() {
    this.db?.close()
    this.db = null
    this.opening = null
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('deleteDatabase blocked'))
    })
  }
}

export const storage = new Storage()
