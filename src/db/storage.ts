import { DB_NAME } from './constants'
import { getLatestDbVersion, getMigrationForVersion } from './migrations'
import { promisifyRequest } from './utils'

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

      for (let versionToMigrateTo = oldVersion + 1; versionToMigrateTo <= latestVersion; versionToMigrateTo++) {
        getMigrationForVersion(versionToMigrateTo)?.(db, transaction)
      }
    }
  })
}

export class Storage {
  private db: IDBDatabase | null = null

  private async init(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDatabase()
    }

    return this.db
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

  async getFirstByIndex<T>(storeName: string, indexName: string, direction: IDBCursorDirection = 'next'): Promise<T | undefined> {
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
