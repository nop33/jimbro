import { expect, test, type Page } from '@playwright/test'

const SET_IDS = ['sess-v7:ex-v7:0', 'sess-v7:ex-v7:1']

const seedVersion7 = (page: Page) =>
  page.evaluate(async (setIds) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gymbro-database', 7)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('exercises', { keyPath: 'id' })
        database.createObjectStore('programs', { keyPath: 'id' })
        const sessions = database.createObjectStore('workoutSessions', { keyPath: 'id' })
        sessions.createIndex('date', 'date', { unique: false })
        sessions.createIndex('programId', 'programId', { unique: false })
        const sets = database.createObjectStore('sets', { keyPath: 'id' })
        sets.createIndex('sessionId', 'sessionId', { unique: false })
        sets.createIndex('exerciseId', 'exerciseId', { unique: false })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sets', 'readwrite')
      const store = tx.objectStore('sets')
      for (let position = 0; position < setIds.length; position++) {
        store.put({
          id: setIds[position],
          sessionId: 'sess-v7',
          exerciseId: 'ex-v7',
          position,
          set: { preset: 'lifting', reps: 8, weight: 40 },
          isDeleted: false,
          updatedAt: '2026-09-27T00:00:00.000Z'
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, SET_IDS)

const runVersion7OnOtherDatabase = (page: Page) =>
  page.evaluate(async () => {
    const { getMigrationForVersion } = await import('/src/db/migrations.ts')
    const migrate = getMigrationForVersion(7)
    if (!migrate) throw new Error('missing version 7 migration')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('audit-flag-db', 7)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('exercises', { keyPath: 'id' })
        database.createObjectStore('programs', { keyPath: 'id' })
        const sessions = database.createObjectStore('workoutSessions', { keyPath: 'id' })
        sessions.createIndex('date', 'date', { unique: false })
        sessions.createIndex('programId', 'programId', { unique: false })
        migrate(database, request.transaction as IDBTransaction)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
  })

const upgradeThroughStorage = (page: Page) =>
  page.evaluate(async () => {
    const { storage } = await import('/src/db/storage.ts')
    const db = await storage.connection()
    const all = (storeName: string) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction(storeName).objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>)
        request.onerror = () => reject(request.error)
      })
    const sets = (await all('sets')) as Array<{ id: string }>
    const groups = (await all('setGroups')) as Array<{ sets: Array<{ id: string }> }>
    return {
      version: db.version,
      hasSetGroups: db.objectStoreNames.contains('setGroups'),
      setIds: sets.map((set) => set.id).sort(),
      groupIds: groups.flatMap((group) => group.sets.map((set) => set.id)).sort()
    }
  })

test('version 8 backfills set groups after version 7 ran on another database', async ({ page }) => {
  await page.goto('/icons/favicon.ico')
  await seedVersion7(page)
  await runVersion7OnOtherDatabase(page)
  const stored = await upgradeThroughStorage(page)
  expect(stored).toEqual({
    version: 9,
    hasSetGroups: true,
    setIds: SET_IDS,
    groupIds: SET_IDS
  })
})

test('version 8 backfills set groups from a version 7 database on a fresh page', async ({ page }) => {
  await page.goto('/icons/favicon.ico')
  await seedVersion7(page)
  const stored = await upgradeThroughStorage(page)
  expect(stored).toEqual({
    version: 9,
    hasSetGroups: true,
    setIds: SET_IDS,
    groupIds: SET_IDS
  })
})
