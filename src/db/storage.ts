import { DB_NAME } from "./constants"
import { getLatestDbVersion, getMigrationForVersion } from "./migrations"
import { promisifyRequest } from "./utils"

const openDatabase = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const latestVersion = getLatestDbVersion()
    const request = window.indexedDB.open(DB_NAME, latestVersion)

    request.onsuccess = (event) => {
      console.error('✅ Opened DB connection', event)
      resolve(request.result)
    }

    request.onerror = (event) => {
      console.error('❌ Could not open DB connection', event)
      reject(request.error)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion

      for (let versionToMigrateTo = oldVersion + 1; versionToMigrateTo <= latestVersion; versionToMigrateTo++) {
        getMigrationForVersion(versionToMigrateTo)?.(db)
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
      db = await this.init();
    }

    const transaction = db.transaction([storeName], mode);

    return transaction.objectStore(storeName);
  }

  async create<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite');
    await promisifyRequest(store.add(item));
    return item;
  }

  async update<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite');
    await promisifyRequest(store.put(item));
    return item;
  }

  async getAll<T>(storeName: string): Promise<Array<T>> {
    const store = await this.getStore(storeName);
    return promisifyRequest(store.getAll());
  }

  async count(storeName: string): Promise<number> {
    const store = await this.getStore(storeName);
    return promisifyRequest(store.count());
  }
}

export const storage = new Storage()
