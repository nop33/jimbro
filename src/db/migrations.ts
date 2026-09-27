import { rowsFromSession, type SetRow } from '../sync/rows'

const version7WritesSetGroups = new WeakSet<IDBDatabase>()

const ensureSetGroups = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains(OBJECT_STORES.SET_GROUPS)) {
    db.createObjectStore(OBJECT_STORES.SET_GROUPS, { keyPath: 'sessionId' })
  }
}
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

export const createCurrentObjectStores = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains(OBJECT_STORES.EXERCISES)) {
    db.createObjectStore(OBJECT_STORES.EXERCISES, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(OBJECT_STORES.PROGRAMS)) {
    db.createObjectStore(OBJECT_STORES.PROGRAMS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(OBJECT_STORES.WORKOUT_SESSIONS)) {
    const sessions = db.createObjectStore(OBJECT_STORES.WORKOUT_SESSIONS, { keyPath: 'id' })
    sessions.createIndex('date', 'date', { unique: false })
    sessions.createIndex('programId', 'programId', { unique: false })
  }
  if (!db.objectStoreNames.contains(OBJECT_STORES.SETS)) {
    const sets = db.createObjectStore(OBJECT_STORES.SETS, { keyPath: 'id' })
    sets.createIndex('sessionId', 'sessionId', { unique: false })
    sets.createIndex('exerciseId', 'exerciseId', { unique: false })
  }
  ensureSetGroups(db)
}

const reparseAllRecords = (transaction: IDBTransaction) => {
  const now = new Date().toISOString()
  const exerciseStore = transaction.objectStore(OBJECT_STORES.EXERCISES)
  const programStore = transaction.objectStore(OBJECT_STORES.PROGRAMS)
  const catalog = new Map<string, Exercise>()

  const upgradeSessions = () => {
    if (!transaction.objectStoreNames.contains(OBJECT_STORES.WORKOUT_SESSIONS)) return
    const sessionStore = transaction.objectStore(OBJECT_STORES.WORKOUT_SESSIONS)
    if (sessionStore.keyPath !== 'id') return
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
    migrate: (_db, transaction) => reparseAllRecords(transaction)
  },
  {
    version: 6,
    migrate: (_db, transaction) => reparseAllRecords(transaction)
  },
  {
    version: 7,
    migrate: (db, transaction) => {
      version7WritesSetGroups.add(db)
      ensureSetGroups(db)
      if (!db.objectStoreNames.contains(OBJECT_STORES.SETS)) {
        const sets = db.createObjectStore(OBJECT_STORES.SETS, { keyPath: 'id' })
        sets.createIndex('sessionId', 'sessionId', { unique: false })
        sets.createIndex('exerciseId', 'exerciseId', { unique: false })
      }
      const now = new Date().toISOString()
      const exerciseStore = transaction.objectStore(OBJECT_STORES.EXERCISES)
      const programStore = transaction.objectStore(OBJECT_STORES.PROGRAMS)
      const sessionStore = transaction.objectStore(OBJECT_STORES.WORKOUT_SESSIONS)
      const setsStore = transaction.objectStore(OBJECT_STORES.SETS)
      const exercisesRequest = exerciseStore.getAll()
      exercisesRequest.onsuccess = () => {
        const catalog = new Map<string, Exercise>()
        for (const raw of exercisesRequest.result as Array<Record<string, unknown>>) {
          const upgraded = upgradeExerciseRecord(raw, now)
          catalog.set(upgraded.id, upgraded)
          exerciseStore.put(upgraded)
        }
        const programsRequest = programStore.getAll()
        programsRequest.onsuccess = () => {
          for (const raw of programsRequest.result as Array<Record<string, unknown>>) {
            programStore.put(upgradeProgramRecord(raw, now))
          }
          const sessionsRequest = sessionStore.getAll()
          sessionsRequest.onsuccess = () => {
            const grouped = new Map<string, Array<SetRow>>()
            const groupStore = transaction.objectStore(OBJECT_STORES.SET_GROUPS)
            for (const raw of sessionsRequest.result as Array<Record<string, unknown>>) {
              const upgraded = upgradeWorkoutSessionRecord(raw, catalog, now)
              const { header, sets } = rowsFromSession(upgraded)
              const storedSets: Array<SetRow> = []
              for (const set of sets) {
                const stored = JSON.parse(JSON.stringify(set)) as SetRow
                setsStore.put(stored)
                storedSets.push(stored)
              }
              if (storedSets.length > 0) grouped.set(header.id, storedSets)
              sessionStore.put(JSON.parse(JSON.stringify(header)))
            }
            // A later migration in this upgrade runs before these callbacks, so groups are written here.
            for (const [sessionId, sets] of grouped) groupStore.put({ sessionId, sets })
          }
        }
      }
    }
  },
  {
    version: 8,
    migrate: (db, transaction) => {
      ensureSetGroups(db)
      // Same upgradeneeded passes one IDBDatabase to versions 7 and 8. Version 7's set
      // puts are still in callbacks, so this connection must not read sets yet.
      if (version7WritesSetGroups.has(db)) return
      const setsRequest = transaction.objectStore(OBJECT_STORES.SETS).getAll()
      const groupStore = transaction.objectStore(OBJECT_STORES.SET_GROUPS)
      setsRequest.onsuccess = () => {
        const bySession = new Map<string, Array<SetRow>>()
        for (const set of setsRequest.result as Array<SetRow>) {
          const list = bySession.get(set.sessionId) ?? []
          list.push(set)
          bySession.set(set.sessionId, list)
        }
        for (const [sessionId, sets] of bySession) groupStore.put({ sessionId, sets })
      }
    }
  }
]
