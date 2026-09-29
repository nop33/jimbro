import { expect, test, type Page } from '@playwright/test'

const DB_NAME = 'gymbro-database'
const UPDATED_AT = '2026-03-01T00:00:00.000Z'

interface IndexShape {
  name: string
  keyPath: string
  unique: boolean
  multiEntry: boolean
}

interface StoreShape {
  name: string
  keyPath: string
  autoIncrement: boolean
  indexes: Array<IndexShape>
}

type Records = Record<string, Array<unknown>>

const index = (name: string): IndexShape => ({ name, keyPath: name, unique: false, multiEntry: false })

const store = (name: string, keyPath: string, indexes: Array<IndexShape> = []): StoreShape => ({
  name,
  keyPath,
  autoIncrement: false,
  indexes
})

// Written out by hand because the upgrade steps that used to build version 9 are gone.
const VERSION_9 = [
  store('exercises', 'id'),
  store('meta', 'name'),
  store('outbox', 'key'),
  store('programs', 'id'),
  store('setGroups', 'sessionId'),
  store('sets', 'id', [index('exerciseId'), index('sessionId')]),
  store('workoutSessions', 'id', [index('date'), index('programId')])
]

// Cursor 0 and no bootstrapped flag, so the next sync is a first sync that pulls everything.
const EMPTY_VERSION_9: Records = {
  exercises: [],
  meta: [{ name: 'cursor', value: 0 }],
  outbox: [],
  programs: [],
  setGroups: [],
  sets: [],
  workoutSessions: []
}

const set = {
  id: 'sess-1:ex-1:0',
  sessionId: 'sess-1',
  exerciseId: 'ex-1',
  position: 0,
  set: { preset: 'lifting', reps: 8, weight: 40 },
  isDeleted: false,
  updatedAt: UPDATED_AT
}

const rows: Records = {
  exercises: [
    {
      id: 'ex-1',
      name: 'Bench press',
      kind: 'lifting',
      preset: 'lifting',
      muscle: 'chest',
      targetSets: 1,
      defaults: { reps: 8 },
      isDeleted: false,
      updatedAt: UPDATED_AT
    }
  ],
  programs: [{ id: 'prog-1', name: 'Push day', exercises: ['ex-1'], isDeleted: false, updatedAt: UPDATED_AT }],
  workoutSessions: [
    {
      id: 'sess-1',
      date: '2026-03-01',
      programId: 'prog-1',
      location: 'Zurich',
      status: 'completed',
      exercises: [
        {
          exerciseId: 'ex-1',
          name: 'Bench press',
          kind: 'lifting',
          preset: 'lifting',
          muscle: 'chest',
          targetSets: 1,
          defaults: { reps: 8 }
        }
      ],
      isDeleted: false,
      updatedAt: UPDATED_AT
    }
  ],
  sets: [set],
  setGroups: [{ sessionId: 'sess-1', sets: [set] }]
}

const STALE_DATABASES: Array<{ version: number; stores: Array<StoreShape>; records: Records }> = [
  {
    version: 1,
    stores: [store('exercises', 'id'), store('templates', 'id'), store('workoutSessions', 'date')],
    records: {
      exercises: [{ id: 'ex-1', name: 'Bench press', muscle: 'Chest', sets: 3, reps: 8 }],
      templates: [{ id: 'tpl-1', name: 'Push day', exercises: ['ex-1'] }],
      workoutSessions: [
        {
          date: '2025-01-06',
          programId: 'tpl-1',
          location: 'Athens',
          status: 'completed',
          exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 8, weight: 40 }] }]
        }
      ]
    }
  },
  {
    version: 8,
    stores: VERSION_9.filter(({ name }) => name !== 'meta' && name !== 'outbox'),
    records: rows
  }
]

// Leaves the database the way an older build did, before any app code opens it.
const seed = (page: Page, version: number, stores: Array<StoreShape>, records: Records) =>
  page.evaluate(
    ({ dbName, version, stores, records }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, version)
        request.onupgradeneeded = () => {
          for (const shape of stores) {
            const created = request.result.createObjectStore(shape.name, { keyPath: shape.keyPath })
            for (const { name, keyPath } of shape.indexes) created.createIndex(name, keyPath)
            for (const record of records[shape.name] ?? []) created.put(record)
          }
        }
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      }),
    { dbName: DB_NAME, version, stores, records }
  )

// Opens without a version, so reading never upgrades anything.
const readDatabase = (page: Page) =>
  page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const names = Array.from(db.objectStoreNames).sort()
    const tx = db.transaction(names, 'readonly')
    const stores = names.map((name) => {
      const objectStore = tx.objectStore(name)
      return {
        name,
        keyPath: objectStore.keyPath,
        autoIncrement: objectStore.autoIncrement,
        indexes: Array.from(objectStore.indexNames)
          .sort()
          .map((indexName) => {
            const found = objectStore.index(indexName)
            return { name: indexName, keyPath: found.keyPath, unique: found.unique, multiEntry: found.multiEntry }
          })
      }
    })
    const records = await Promise.all(
      names.map(
        (name) =>
          new Promise<[string, Array<unknown>]>((resolve, reject) => {
            const request = tx.objectStore(name).getAll()
            request.onsuccess = () => resolve([name, request.result])
            request.onerror = () => reject(request.error)
          })
      )
    )
    const version = db.version
    db.close()
    return { version, stores, records: Object.fromEntries(records) }
  }, DB_NAME)

test('a fresh install creates the version 9 schema', async ({ page }) => {
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Seed Database' })).toBeVisible()
  expect(await readDatabase(page)).toEqual({ version: 9, stores: VERSION_9, records: EMPTY_VERSION_9 })
})

test('a version 9 database opens with its rows untouched', async ({ page }) => {
  const stored = {
    ...rows,
    meta: [
      { name: 'cursor', value: 42 },
      { name: 'seq', value: 1 }
    ],
    outbox: [{ key: 'sets:sess-1:ex-1:0', table: 'sets', id: 'sess-1:ex-1:0', seq: 1 }]
  }
  await page.goto('/icons/favicon.ico')
  await seed(page, 9, VERSION_9, stored)
  await page.goto('/workouts/')
  await expect(page.getByText('Push day').first()).toBeVisible()
  expect(await readDatabase(page)).toEqual({ version: 9, stores: VERSION_9, records: stored })
})

for (const stale of STALE_DATABASES) {
  test(`a version ${stale.version} database is dropped and rebuilt as version 9`, async ({ page }) => {
    await page.goto('/icons/favicon.ico')
    await seed(page, stale.version, stale.stores, stale.records)
    await page.goto('/workouts/')
    await expect(page.getByRole('button', { name: 'Seed Database' })).toBeVisible()
    expect(await readDatabase(page)).toEqual({ version: 9, stores: VERSION_9, records: EMPTY_VERSION_9 })
  })
}
