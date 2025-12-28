import { OBJECT_STORES } from "./constants";

export interface DbMigration {
  version: number;
  migrate: (db: IDBDatabase) => void
}

export const getLatestDbVersion = (): number => migrations.at(-1)?.version ?? 0

export const getMigrationForVersion = (version: DbMigration['version']) =>
  migrations.find((migration) => migration.version === version)?.migrate

const migrations: Array<DbMigration> = [
  {
    version: 1,
    migrate: (db) => {
      if (!db.objectStoreNames.contains(OBJECT_STORES.EXERSISES)) {
        db.createObjectStore(OBJECT_STORES.EXERSISES, { keyPath: 'id' })
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
  }
]
