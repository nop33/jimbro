import { expect, test, type Page } from '@playwright/test'
import { rowsFromSession } from '../src/sync/rows'
import type { NestedSession, SetRow } from '../src/db/types'

const DB_NAME = 'gymbro-database'
const UPDATED_AT = '2026-03-01T00:00:00.000Z'

const exerciseOne = {
  id: 'ex-1',
  name: 'Bench press',
  kind: 'lifting' as const,
  preset: 'lifting' as const,
  muscle: 'chest' as const,
  targetSets: 2,
  defaults: { reps: 8 },
  isDeleted: false,
  updatedAt: UPDATED_AT
}

const exerciseTwo = {
  id: 'ex-2',
  name: 'Squat',
  kind: 'lifting' as const,
  preset: 'lifting' as const,
  muscle: 'quads' as const,
  targetSets: 1,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: UPDATED_AT
}

const program = {
  id: 'prog-1',
  name: 'Import Program',
  exercises: ['ex-1', 'ex-2'],
  isDeleted: false,
  updatedAt: UPDATED_AT
}

const sourceSessions: Array<NestedSession> = [
  {
    id: 'sess-1',
    date: '2026-03-01',
    programId: 'prog-1',
    location: 'Zurich',
    status: 'completed',
    notes: 'keep me',
    updatedAt: UPDATED_AT,
    exercises: [
      {
        exerciseId: 'ex-1',
        name: 'Bench press',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'chest',
        targetSets: 2,
        defaults: { reps: 8 },
        sets: [
          { preset: 'lifting', reps: 8, weight: 40 },
          { preset: 'lifting', reps: 6, weight: 42 }
        ]
      },
      {
        exerciseId: 'ex-2',
        name: 'Squat',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'quads',
        targetSets: 1,
        defaults: { reps: 5 },
        sets: [{ preset: 'lifting', reps: 10, weight: 20 }]
      }
    ]
  },
  {
    id: 'sess-2',
    date: '2026-03-03',
    programId: 'prog-1',
    location: 'Zurich',
    status: 'completed',
    updatedAt: UPDATED_AT,
    exercises: [
      {
        exerciseId: 'ex-1',
        name: 'Bench press',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'chest',
        targetSets: 2,
        defaults: { reps: 8 },
        sets: [{ preset: 'lifting', reps: 5, weight: 30 }]
      }
    ]
  },
  {
    id: 'sess-3',
    date: '2026-03-02',
    programId: 'prog-1',
    location: 'Athens',
    status: 'incomplete',
    updatedAt: UPDATED_AT,
    exercises: [
      {
        exerciseId: 'ex-2',
        name: 'Squat',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'quads',
        targetSets: 1,
        defaults: { reps: 5 },
        sets: []
      }
    ]
  }
]

const expectedSetRows = sourceSessions.flatMap((session) => rowsFromSession(session).sets)

const importFile = async (page: Page, name: string, data: unknown) => {
  await page.locator('#import-input').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data))
  })
  const toast = page.locator('.toast-message-popup')
  await expect(toast).toHaveText('Database imported!')
  await toast.click()
  await expect(toast).toHaveCount(0)
}

async function readStore<T>(page: Page, storeName: string): Promise<Array<T>> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<Array<T>>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly')
          const request = tx.objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result as Array<T>)
          request.onerror = () => reject(request.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, storeName }
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/settings/')
  await page.getByText('Manage local data').click()
  await importFile(page, 'export.json', {
    version: 4,
    exportDate: UPDATED_AT,
    stores: { exercises: [exerciseOne, exerciseTwo], programs: [program], workoutSessions: sourceSessions }
  })
})

test('a version 4 export is stored as session headers and set rows', async ({ page }) => {
  const headers = await readStore<{ id: string; exercises: Array<Record<string, unknown>> }>(page, 'workoutSessions')
  const sets = await readStore<SetRow>(page, 'sets')
  expect(headers).toHaveLength(3)
  expect(headers.every((header) => header.exercises.every((exercise) => !('sets' in exercise)))).toBe(true)
  const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)
  expect([...sets].sort(byId)).toEqual([...expectedSetRows].sort(byId))

  const assembled = await page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    return workoutSessionsStore.getById('sess-1')
  })
  expect(assembled?.exercises[0].sets).toEqual([
    { preset: 'lifting', reps: 8, weight: 40 },
    { preset: 'lifting', reps: 6, weight: 42 }
  ])
  expect(assembled?.exercises[1].sets).toEqual([{ preset: 'lifting', reps: 10, weight: 20 }])
  expect(assembled?.location).toBe('Zurich')
})

test('a later export does not overwrite rows that already exist', async ({ page }) => {
  const later = '2026-04-01T00:00:00.000Z'
  await importFile(page, 'later.json', {
    version: 4,
    exportDate: later,
    stores: {
      exercises: [{ ...exerciseOne, name: 'Renamed bench', targetSets: 9, defaults: { reps: 1 }, updatedAt: later }],
      programs: [],
      workoutSessions: [
        {
          ...sourceSessions[0],
          location: 'Elsewhere',
          updatedAt: later,
          exercises: [
            {
              ...sourceSessions[0].exercises[0],
              sets: [
                { preset: 'lifting', reps: 1, weight: 999 },
                { preset: 'lifting', reps: 1, weight: 999 }
              ]
            }
          ]
        }
      ]
    }
  })

  const exercises = await readStore<{ id: string; name: string }>(page, 'exercises')
  const headers = await readStore<{ id: string; location: string }>(page, 'workoutSessions')
  const sets = await readStore<SetRow>(page, 'sets')
  expect(exercises.find((exercise) => exercise.id === 'ex-1')?.name).toBe('Bench press')
  expect(headers.find((header) => header.id === 'sess-1')?.location).toBe('Zurich')
  expect(sets.find((set) => set.id === 'sess-1:ex-1:0')?.set).toEqual({ preset: 'lifting', reps: 8, weight: 40 })
  expect(sets).toHaveLength(4)
})

test('a version 1 export skips a session already stored for its date and program', async ({ page }) => {
  await importFile(page, 'v1-duplicate.json', {
    version: 1,
    exportDate: '2026-04-02T00:00:00.000Z',
    stores: {
      exercises: [],
      programs: [],
      workoutSessions: [
        {
          date: '2026-03-01',
          programId: 'prog-1',
          location: 'Elsewhere',
          status: 'completed',
          exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 1, weight: 1 }] }]
        }
      ]
    }
  })

  const headers = await readStore<{ id: string; location: string }>(page, 'workoutSessions')
  expect(headers).toHaveLength(3)
  expect(headers.find((header) => header.id === 'sess-1')?.location).toBe('Zurich')
  expect(await readStore<SetRow>(page, 'sets')).toHaveLength(4)
})

test('a version 1 export adds a new session and its sets', async ({ page }) => {
  await importFile(page, 'v1-new.json', {
    version: 1,
    exportDate: '2026-04-03T00:00:00.000Z',
    stores: {
      exercises: [{ id: 'ex-1', name: 'Bench press', muscle: 'Chest', sets: 2, reps: 8 }],
      programs: [],
      workoutSessions: [
        {
          date: '2020-01-01',
          programId: 'prog-1',
          location: 'Patras',
          status: 'completed',
          exercises: [
            {
              exerciseId: 'ex-1',
              sets: [
                { reps: 3, weight: 15 },
                { reps: 3, weight: 15 }
              ]
            }
          ]
        }
      ]
    }
  })

  const headers = await readStore<{ date: string; location: string }>(page, 'workoutSessions')
  expect(headers).toHaveLength(4)
  expect(headers.find((header) => header.date === '2020-01-01')?.location).toBe('Patras')
  expect(await readStore<SetRow>(page, 'sets')).toHaveLength(6)
})
