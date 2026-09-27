import { expect, test, type Page } from '@playwright/test'
import { rowsFromSession, type NestedSession, type SetRow } from '../src/sync/rows'

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
  name: 'Migration Program',
  exercises: ['ex-1', 'ex-2'],
  isDeleted: false,
  updatedAt: UPDATED_AT
}

const sourceSessions: Array<NestedSession> = [
  {
    id: 'mig-1',
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
    id: 'mig-2',
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
    id: 'mig-3',
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

async function openVersion6(page: Page): Promise<void> {
  await page.goto('/__pr_rows_blank')
  await page.evaluate(
    async ({ dbName, exerciseOne, exerciseTwo, program, sourceSessions }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 6)
        request.onupgradeneeded = () => {
          const database = request.result
          database.createObjectStore('exercises', { keyPath: 'id' })
          database.createObjectStore('programs', { keyPath: 'id' })
          const sessions = database.createObjectStore('workoutSessions', { keyPath: 'id' })
          sessions.createIndex('date', 'date', { unique: false })
          sessions.createIndex('programId', 'programId', { unique: false })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['exercises', 'programs', 'workoutSessions'], 'readwrite')
        tx.objectStore('exercises').put(exerciseOne)
        tx.objectStore('exercises').put(exerciseTwo)
        tx.objectStore('programs').put(program)
        for (const session of sourceSessions) tx.objectStore('workoutSessions').put(session)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { dbName: DB_NAME, exerciseOne, exerciseTwo, program, sourceSessions }
  )
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

test('migrates a version 6 database into headers and set rows and refuses to overwrite an existing row', async ({
  page
}) => {
  await openVersion6(page)
  await page.goto('/workouts/')
  await expect(page.getByText('Migration Program').first()).toBeVisible()

  const headers = await readStore<{ id: string; exercises: Array<Record<string, unknown>>; location: string }>(
    page,
    'workoutSessions'
  )
  const sets = await readStore<SetRow>(page, 'sets')
  expect(headers).toHaveLength(3)
  expect(sets).toHaveLength(4)
  expect(headers.every((header) => header.exercises.every((exercise) => !('sets' in exercise)))).toBe(true)

  const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)
  expect([...sets].sort(byId)).toEqual([...expectedSetRows].sort(byId))

  const assembled = await page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    return workoutSessionsStore.getWorkoutSession('mig-1')
  })
  expect(assembled?.exercises[0].sets).toEqual([
    { preset: 'lifting', reps: 8, weight: 40 },
    { preset: 'lifting', reps: 6, weight: 42 }
  ])
  expect(assembled?.exercises[1].sets).toEqual([{ preset: 'lifting', reps: 10, weight: 20 }])
  expect(assembled?.location).toBe('Zurich')

  await page.evaluate(async () => {
    const { importIndexedDbFromJson } = await import('/src/db/import.ts')
    const file = new File(
      [
        JSON.stringify({
          version: 4,
          exportDate: '2026-04-01T00:00:00.000Z',
          stores: {
            exercises: [
              {
                id: 'ex-1',
                name: 'Renamed bench',
                kind: 'lifting',
                preset: 'lifting',
                muscle: 'chest',
                targetSets: 9,
                defaults: { reps: 1 },
                isDeleted: false,
                updatedAt: '2026-04-01T00:00:00.000Z'
              }
            ],
            programs: [],
            workoutSessions: [
              {
                id: 'mig-1',
                date: '2026-03-01',
                programId: 'prog-1',
                location: 'Elsewhere',
                status: 'completed',
                updatedAt: '2026-04-01T00:00:00.000Z',
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
                      { preset: 'lifting', reps: 1, weight: 999 },
                      { preset: 'lifting', reps: 1, weight: 999 }
                    ]
                  }
                ]
              }
            ]
          }
        })
      ],
      'import.json',
      { type: 'application/json' }
    )
    await importIndexedDbFromJson(file)
  })

  const exercises = await readStore<{ id: string; name: string }>(page, 'exercises')
  const setsAfter = await readStore<SetRow>(page, 'sets')
  expect(exercises.find((exercise) => exercise.id === 'ex-1')?.name).toBe('Bench press')
  expect(setsAfter.find((set) => set.id === 'mig-1:ex-1:0')?.set).toEqual({ preset: 'lifting', reps: 8, weight: 40 })
  expect(setsAfter).toHaveLength(4)

  await page.evaluate(async () => {
    const { importIndexedDbFromJson } = await import('/src/db/import.ts')
    const duplicate = new File(
      [
        JSON.stringify({
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
      ],
      'v1-duplicate.json',
      { type: 'application/json' }
    )
    await importIndexedDbFromJson(duplicate)
  })

  const headersAfterDuplicate = await readStore<{ id: string; location: string }>(page, 'workoutSessions')
  expect(headersAfterDuplicate).toHaveLength(3)
  expect(headersAfterDuplicate.find((header) => header.id === 'mig-1')?.location).toBe('Zurich')

  await page.evaluate(async () => {
    const { importIndexedDbFromJson } = await import('/src/db/import.ts')
    const fresh = new File(
      [
        JSON.stringify({
          version: 1,
          exportDate: '2026-04-03T00:00:00.000Z',
          stores: {
            exercises: [
              {
                id: 'ex-1',
                name: 'Bench press',
                muscle: 'Chest',
                sets: 2,
                reps: 8
              }
            ],
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
      ],
      'v1-new.json',
      { type: 'application/json' }
    )
    await importIndexedDbFromJson(fresh)
  })

  const headersAfterNew = await readStore<{ date: string; location: string }>(page, 'workoutSessions')
  const setsAfterNew = await readStore<SetRow>(page, 'sets')
  expect(headersAfterNew).toHaveLength(4)
  expect(headersAfterNew.find((header) => header.date === '2020-01-01')?.location).toBe('Patras')
  expect(setsAfterNew).toHaveLength(6)
})
