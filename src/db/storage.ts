import type { Row, RowTable, SetRow } from '../sync/rows'
import { DB_NAME, OBJECT_STORES } from './constants'
import { createCurrentObjectStores, getLatestDbVersion, getMigrationForVersion } from './migrations'
import { promisifyRequest } from './promisifyRequest'

const STORE_FOR_TABLE: Record<RowTable, string> = {
  exercises: OBJECT_STORES.EXERCISES,
  programs: OBJECT_STORES.PROGRAMS,
  sessions: OBJECT_STORES.WORKOUT_SESSIONS,
  sets: OBJECT_STORES.SETS
}

const cloneForIdb = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T

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
    const latestVersion = getLatestDbVersion()
    const request = window.indexedDB.open(DB_NAME, latestVersion)

    request.onsuccess = (event) => {
      console.log('✅ Opened DB connection', event)
      resolve(request.result)
    }

    request.onerror = (event) => {
      console.error('❌ Could not open DB connection', event)
      reject(request.error)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const transaction = (event.target as IDBOpenDBRequest).transaction!
      const oldVersion = event.oldVersion

      // Fresh DBs skip v1–v4 (v4 deletes workoutSessions mid-upgrade). Create v5 stores directly.
      if (oldVersion === 0) {
        createCurrentObjectStores(db)
        return
      }

      for (let versionToMigrateTo = oldVersion + 1; versionToMigrateTo <= latestVersion; versionToMigrateTo++) {
        // v5 and v6 rewrite these records on cursors. v7 splits them in this same
        // transaction, so those cursors would put the nested sessions back.
        if (latestVersion >= 7 && versionToMigrateTo >= 5 && versionToMigrateTo < 7) continue
        getMigrationForVersion(versionToMigrateTo)?.(db, transaction)
      }
    }
  })
}

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

  async writeRows(writes: Array<Row>): Promise<void> {
    if (writes.length === 0) return
    const db = await this.init()
    const storeNames = [...new Set(writes.map((write) => STORE_FOR_TABLE[write.table]))]
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
        for (const write of writes) {
          tx.objectStore(STORE_FOR_TABLE[write.table]).put(cloneForIdb(write.row))
        }
        if (setWrites.length === 0) return
        const bySession = new Map<string, Array<SetRow>>()
        for (const write of setWrites) {
          const list = bySession.get(write.row.sessionId) ?? []
          list.push(cloneForIdb(write.row))
          bySession.set(write.row.sessionId, list)
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
      } catch (error) {
        fail(error)
      }
    })
  }

  async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    let db = this.db

    if (!db) {
      db = await this.init()
    }

    const transaction = db.transaction([storeName], mode)

    return transaction.objectStore(storeName)
  }

  async create<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.add(item))
    return item
  }

  async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const result = await promisifyRequest<T | undefined>(store.get(key))
    return result
  }

  async update<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.put(item))
    return item
  }

  async getByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return promisifyRequest<T | undefined>(index.get(key))
  }

  async getAllByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<Array<T>> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return promisifyRequest(index.getAll(key))
  }

  async getFirstByIndex<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection = 'next'
  ): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(null, direction)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        resolve(cursor ? (cursor.value as T) : undefined)
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
  }

  async getFirstByPredicate<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection = 'next',
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
    indexedDB.deleteDatabase(DB_NAME)
  }

  async delete(storeName: string, key: string | number): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.delete(key))
  }
}

export const storage = new Storage()
