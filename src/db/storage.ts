import { DB_NAME } from "./constants"
import { getLatestDbVersion, getMigrationForVersion } from "./migrations"

class Storage {
  private db: IDBDatabase | null = null

  constructor() {
    if (!this.db) {
      const latestVersion = getLatestDbVersion()
      const request = window.indexedDB.open(DB_NAME, latestVersion)

      request.onsuccess = (event) => {
        console.error('✅ Opened DB connection', event)
        this.db = request.result
      }

      request.onerror = (event) => console.error('❌ Could not open DB connection', event)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const oldVersion = event.oldVersion

        for (let versionToMigrateTo = oldVersion + 1; versionToMigrateTo <= latestVersion; versionToMigrateTo++) {
          getMigrationForVersion(versionToMigrateTo)?.(db)
        }
      }
    }
  }
}

export const storage = new Storage()
