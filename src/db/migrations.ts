import { OBJECT_STORES } from './constants'

// Opening a database below its stored version throws a VersionError, so this only goes up.
export const DB_VERSION = 9

const createVersion9Stores = (db: IDBDatabase) => {
  db.createObjectStore(OBJECT_STORES.EXERCISES, { keyPath: 'id' })
  db.createObjectStore(OBJECT_STORES.PROGRAMS, { keyPath: 'id' })
  const sessions = db.createObjectStore(OBJECT_STORES.WORKOUT_SESSIONS, { keyPath: 'id' })
  sessions.createIndex('date', 'date', { unique: false })
  sessions.createIndex('programId', 'programId', { unique: false })
  const sets = db.createObjectStore(OBJECT_STORES.SETS, { keyPath: 'id' })
  sets.createIndex('sessionId', 'sessionId', { unique: false })
  sets.createIndex('exerciseId', 'exerciseId', { unique: false })
  db.createObjectStore(OBJECT_STORES.SET_GROUPS, { keyPath: 'sessionId' })
  db.createObjectStore(OBJECT_STORES.OUTBOX, { keyPath: 'key' })
  db.createObjectStore(OBJECT_STORES.META, { keyPath: 'name' }).put({ name: 'cursor', value: 0 })
}

// Runs in onupgradeneeded. A new version gets its own `if (oldVersion < N)` step after this one.
export const upgradeDatabase = (db: IDBDatabase, oldVersion: number) => {
  // Every install was on version 9 when the older upgrade steps were deleted. An older database can only
  // be a stale browser profile, so it starts over empty and the first sync pulls everything from the server.
  // The 9 stays a literal so that raising DB_VERSION never wipes a version 9 database.
  if (oldVersion < 9) {
    if (oldVersion > 0) console.warn(`IndexedDB version ${oldVersion} is too old to upgrade, rebuilding it empty`)
    for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
    createVersion9Stores(db)
  }
}
