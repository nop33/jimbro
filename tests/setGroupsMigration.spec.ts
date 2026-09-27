import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { upgradeExerciseRecord, upgradeProgramRecord, upgradeWorkoutSessionRecord } from '../src/db/schemaUpgrade'
import type { Exercise } from '../src/db/stores/exercisesStore'

const DB_NAME = 'gymbro-database'
const NOW = '2026-01-02T10:24:41.458Z'

test('version 6 January history builds set groups from the rows migration 7 writes', async ({ page }) => {
  const raw = JSON.parse(readFileSync('data-backup/gymbro-export-2026-01-02.json', 'utf8')) as {
    stores: {
      exercises: Array<Record<string, unknown>>
      programs: Array<Record<string, unknown>>
      workoutSessions: Array<Record<string, unknown>>
    }
  }
  const exercises = raw.stores.exercises.map((exercise) => upgradeExerciseRecord(exercise, NOW))
  const programs = raw.stores.programs.map((program) => upgradeProgramRecord(program, NOW))
  const catalog = new Map<string, Exercise>(exercises.map((exercise) => [exercise.id, exercise]))
  const sessions = raw.stores.workoutSessions.map((session, index) =>
    upgradeWorkoutSessionRecord({ ...session, id: `jan-session-${index}` }, catalog, NOW)
  )
  const sourceSets = sessions.reduce(
    (total, session) => total + session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    0
  )
  expect(sessions).toHaveLength(106)
  expect(sourceSets).toBe(2581)

  await page.goto('/icons/favicon.ico')
  await page.evaluate(
    async ({ dbName, exercises, programs, sessions }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 6)
        request.onupgradeneeded = () => {
          const database = request.result
          database.createObjectStore('exercises', { keyPath: 'id' })
          database.createObjectStore('programs', { keyPath: 'id' })
          const workoutSessions = database.createObjectStore('workoutSessions', { keyPath: 'id' })
          workoutSessions.createIndex('date', 'date', { unique: false })
          workoutSessions.createIndex('programId', 'programId', { unique: false })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['exercises', 'programs', 'workoutSessions'], 'readwrite')
        for (const exercise of exercises) tx.objectStore('exercises').put(exercise)
        for (const program of programs) tx.objectStore('programs').put(program)
        for (const session of sessions) tx.objectStore('workoutSessions').put(session)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { dbName: DB_NAME, exercises, programs, sessions }
  )

  await page.goto('/workouts/')
  await page.locator('.workout-week').first().waitFor()

  const stored = await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = (storeName: string) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction(storeName).objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>)
        request.onerror = () => reject(request.error)
      })
    const sets = (await all('sets')) as Array<{ id: string }>
    const groups = (await all('setGroups')) as Array<{ sets: Array<{ id: string }> }>
    db.close()
    return {
      setIds: sets.map((set) => set.id).sort(),
      groupIds: groups.flatMap((group) => group.sets.map((set) => set.id)).sort()
    }
  }, DB_NAME)

  expect(stored.setIds).toHaveLength(2581)
  expect(stored.groupIds).toEqual(stored.setIds)
})
