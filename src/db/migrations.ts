import { OBJECT_STORES } from './constants'
import { upgradeExerciseRecord, upgradeProgramRecord, upgradeWorkoutSessionRecord } from './schemaUpgrade'
import type { Exercise } from './stores/exercisesStore'

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
  },
  {
    version: 5,
    migrate: (_db, transaction) => {
      const now = new Date().toISOString()
      const exerciseStore = transaction.objectStore(OBJECT_STORES.EXERCISES)
      const programStore = transaction.objectStore(OBJECT_STORES.PROGRAMS)
      const sessionStore = transaction.objectStore(OBJECT_STORES.WORKOUT_SESSIONS)
      const catalog = new Map<string, Exercise>()

      const upgradeSessions = () => {
        const sessionCursor = sessionStore.openCursor()
        sessionCursor.onsuccess = () => {
          const cursor = sessionCursor.result
          if (!cursor) return
          cursor.update(upgradeWorkoutSessionRecord(cursor.value as Record<string, unknown>, catalog, now))
          cursor.continue()
        }
      }

      const upgradePrograms = () => {
        const programCursor = programStore.openCursor()
        programCursor.onsuccess = () => {
          const cursor = programCursor.result
          if (!cursor) {
            upgradeSessions()
            return
          }
          cursor.update(upgradeProgramRecord(cursor.value as Record<string, unknown>, now))
          cursor.continue()
        }
      }

      const exerciseCursor = exerciseStore.openCursor()
      exerciseCursor.onsuccess = () => {
        const cursor = exerciseCursor.result
        if (!cursor) {
          upgradePrograms()
          return
        }
        const upgraded = upgradeExerciseRecord(cursor.value as Record<string, unknown>, now)
        catalog.set(upgraded.id, upgraded)
        cursor.update(upgraded)
        cursor.continue()
      }
    }
  }
]
