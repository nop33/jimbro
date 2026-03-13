import { OBJECT_STORES } from './constants'

export interface DbMigration {
  version: number
  migrate: (db: IDBDatabase, transaction: IDBTransaction) => void
}

export const getLatestDbVersion = (): number => migrations.at(-1)?.version ?? 0

export const getMigrationForVersion = (version: DbMigration['version']) =>
  migrations.find((migration) => migration.version === version)?.migrate

const migrations: Array<DbMigration> = [
  {
    version: 1,
    migrate: (db) => {
      if (!db.objectStoreNames.contains(OBJECT_STORES.EXERCISES)) {
        db.createObjectStore(OBJECT_STORES.EXERCISES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OBJECT_STORES.WORKOUT_SESSIONS)) {
        db.createObjectStore(OBJECT_STORES.WORKOUT_SESSIONS, { keyPath: 'date' })
      }
    }
  },
  {
    version: 2,
    migrate: (db) => {
      if (db.objectStoreNames.contains('templates')) {
        db.deleteObjectStore('templates')
      }
      if (!db.objectStoreNames.contains('programms')) {
        db.createObjectStore('programms', { keyPath: 'id' })
      }
    }
  },
  {
    version: 3,
    migrate: (db) => {
      if (db.objectStoreNames.contains('programms')) {
        db.deleteObjectStore('programms')
      }
      if (!db.objectStoreNames.contains(OBJECT_STORES.PROGRAMS)) {
        db.createObjectStore(OBJECT_STORES.PROGRAMS, { keyPath: 'id' })
      }
    }
  },
  {
    version: 4,
    migrate: (db, transaction) => {
      const oldStore = transaction.objectStore(OBJECT_STORES.WORKOUT_SESSIONS)
      const getAllRequest = oldStore.getAll()

      getAllRequest.onsuccess = () => {
        const existingRecords = getAllRequest.result

        db.deleteObjectStore(OBJECT_STORES.WORKOUT_SESSIONS)

        const newStore = db.createObjectStore(OBJECT_STORES.WORKOUT_SESSIONS, { keyPath: 'id' })
        newStore.createIndex('date', 'date', { unique: false })
        newStore.createIndex('programId', 'programId', { unique: false })

        for (const record of existingRecords) {
          record.id = crypto.randomUUID()
          newStore.add(record)
        }
      }
    }
  }
]
