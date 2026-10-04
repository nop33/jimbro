import { DB_NAME, OBJECT_STORES } from './constants'
import { DB_VERSION, upgradeDatabase } from './migrations'
import { promisifyRequest } from './promisifyRequest'
import type { RowTable } from './types'

export const STORE_FOR_TABLE: Record<RowTable, string> = {
  exercises: OBJECT_STORES.EXERCISES,
  programs: OBJECT_STORES.PROGRAMS,
  sessions: OBJECT_STORES.WORKOUT_SESSIONS,
  sets: OBJECT_STORES.SETS
}

export const cloneForIdb = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T

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

export class DatabaseConnection {
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

  async getDatabase(): Promise<IDBDatabase> {
    return this.init()
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
