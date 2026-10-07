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

// setGroups caches each session's set rows, so the history reads one record per session. Every transaction that
// writes set rows updates it.
export const mergeSetGroups = (tx: IDBTransaction, sets: Array<SetRow>) => {
  if (sets.length === 0) return
  const bySession = new Map<string, Array<SetRow>>()
  for (const set of sets) {
    const list = bySession.get(set.sessionId) ?? []
    list.push(cloneForIdb(set))
    bySession.set(set.sessionId, list)
  }
  const groupStore = tx.objectStore(OBJECT_STORES.SET_GROUPS)
  for (const [sessionId, rows] of bySession) {
    const request = groupStore.get(sessionId)
    request.onsuccess = () => {
      const current = (request.result?.sets ?? []) as Array<SetRow>
      const merged = new Map(current.map((set) => [set.id, set]))
      for (const row of rows) merged.set(row.id, row)
      groupStore.put({ sessionId, sets: [...merged.values()] })
    }
  }
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
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

  private async init(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (!this.opening) {
      this.opening = openDatabase().then((db) => {
        this.db = db
        return db
      })
    }
    return this.opening
  }

  async connection(): Promise<IDBDatabase> {
    return this.init()
  }

  // Stores the rows, queues each one for the next push and updates setGroups, all in one transaction.
  async writeRows(writes: Array<Row>): Promise<void> {
    if (writes.length === 0) return
    const db = await this.init()
    const storeNames = [...new Set(writes.map((write) => STORE_FOR_TABLE[write.table]))]
    storeNames.push(...QUEUE_STORES)
    const setWrites = writes.filter((write): write is { table: 'sets'; row: SetRow } => write.table === 'sets')
    if (setWrites.length > 0) storeNames.push(OBJECT_STORES.SET_GROUPS)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite')
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
        mergeSetGroups(
          tx,
          setWrites.map((write) => write.row)
        )
        queueRows(tx, writes)
      } catch (error) {
        fail(error)
      }
    })
    window.dispatchEvent(new CustomEvent('jimbro:rows-written'))
    announce('rows-written')
  }

  private async getStore(storeName: string): Promise<IDBObjectStore> {
    let db = this.db

    if (!db) {
      db = await this.init()
    }

    const transaction = db.transaction([storeName], 'readonly')

    return transaction.objectStore(storeName)
  }

  async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const result = await promisifyRequest<T | undefined>(store.get(key))
    return result
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
