import { test, expect, type Page } from '@playwright/test'

/**
 * These tests verify that the workout session status stays in sync with the
 * actual completion state of its exercises, even when the user mutates the
 * exercise list (delete / add) rather than logging a last set.
 *
 * Setup uses direct IndexedDB writes (via page.evaluate) to skip the slow path
 * of logging every set through the UI. The operation under test still goes
 * through the real UI -> state layer -> IDB path, which is what we care about.
 */

const DB_NAME = 'gymbro-database'

// Push day program ID from src/db/stores/seed-programs.json
const PUSH_DAY_PROGRAM_ID = '07c50b23-d3ad-4c30-a4a9-d8bdf58a2300'

// A seeded exercise that is NOT part of Push Day (it's in Pull Day).
// We use its name to locate the card in the AddExerciseDialog.
const EXERCISE_NOT_IN_PUSH_DAY = {
  id: '17208184-8e68-4acf-9709-643305c1ac3e',
  name: 'Pull down machine'
}

interface SeedSessionInput {
  id: string
  programId: string
  status: 'completed' | 'incomplete'
  exercises: Array<{ exerciseId: string; sets: Array<{ reps: number; weight: number }> }>
}

async function writeSessionToIdb(page: Page, session: SeedSessionInput): Promise<void> {
  await page.evaluate(
    async ({ dbName, s }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('workoutSessions', 'readwrite')
          tx.objectStore('workoutSessions').put({
            id: s.id,
            date: new Date().toISOString().slice(0, 10),
            programId: s.programId,
            exercises: s.exercises,
            location: '',
            status: s.status,
            notes: ''
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, s: session }
  )
}

async function readProgramExerciseIds(page: Page, programId: string): Promise<string[]> {
  return await page.evaluate(
    async ({ dbName, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction('programs', 'readonly')
          const req = tx.objectStore('programs').get(id)
          req.onsuccess = () => {
            const program = req.result as { exercises: string[] } | undefined
            resolve(program?.exercises ?? [])
          }
          req.onerror = () => reject(req.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, id: programId }
  )
}

async function readExerciseDef(page: Page, exerciseId: string): Promise<{ sets: number; reps: number } | undefined> {
  return await page.evaluate(
    async ({ dbName, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        return await new Promise<{ sets: number; reps: number } | undefined>((resolve, reject) => {
          const tx = db.transaction('exercises', 'readonly')
          const req = tx.objectStore('exercises').get(id)
          req.onsuccess = () => resolve(req.result as { sets: number; reps: number } | undefined)
          req.onerror = () => reject(req.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, id: exerciseId }
  )
}

async function readSessionStatus(page: Page, sessionId: string): Promise<string | undefined> {
  return await page.evaluate(
    async ({ dbName, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        return await new Promise<string | undefined>((resolve, reject) => {
          const tx = db.transaction('workoutSessions', 'readonly')
          const req = tx.objectStore('workoutSessions').get(id)
          req.onsuccess = () => resolve((req.result as { status?: string } | undefined)?.status)
          req.onerror = () => reject(req.error)
        })
      } finally {
        db.close()
      }
    },
    { dbName: DB_NAME, id: sessionId }
  )
}

async function buildCompletedExercisesFor(page: Page, programId: string) {
  const ids = await readProgramExerciseIds(page, programId)
  const result: Array<{ exerciseId: string; sets: Array<{ reps: number; weight: number }> }> = []
  for (const exId of ids) {
    const def = await readExerciseDef(page, exId)
    if (!def) throw new Error(`Exercise ${exId} missing from seeded DB`)
    result.push({
      exerciseId: exId,
      sets: Array.from({ length: def.sets }, () => ({ reps: def.reps, weight: 50 }))
    })
  }
  return result
}

test.describe('Workout session status reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()
  })

  test('deleting the last incomplete exercise transitions the session to completed', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    // Empty the last exercise so the session is legitimately incomplete
    const lastExerciseId = exercises[exercises.length - 1].exerciseId
    exercises[exercises.length - 1].sets = []

    await writeSessionToIdb(page, {
      id: sessionId,
      programId: PUSH_DAY_PROGRAM_ID,
      status: 'incomplete',
      exercises
    })

    await page.goto(`/gymtime/?id=${sessionId}`)

    const lastCard = page.locator(`[data-exercise-id="${lastExerciseId}"]`)
    await lastCard.scrollIntoViewIfNeeded()
    await lastCard.locator('.exercise-details').click()

    page.once('dialog', (dialog) => dialog.accept())
    await lastCard.locator('.delete-workout-session-exercise-btn').click()

    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('completed')

    await page.goto('/workouts/')
    const sessionCard = page.locator('.workout-week li:has-text("Push day") .card').first()
    await expect(sessionCard).toHaveClass(/card-success/)
  })

  test('adding an exercise to a completed session transitions it back to incomplete', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    await writeSessionToIdb(page, {
      id: sessionId,
      programId: PUSH_DAY_PROGRAM_ID,
      status: 'completed',
      exercises
    })

    await page.goto(`/gymtime/?id=${sessionId}`)

    const addExerciseCard = page.locator('#add-exercise-card')
    await addExerciseCard.scrollIntoViewIfNeeded()
    await addExerciseCard.click()

    const dialog = page.locator('#add-exercise-dialog')
    await expect(dialog).toBeVisible()

    const targetCard = dialog.locator(`.card:has-text("${EXERCISE_NOT_IN_PUSH_DAY.name}")`).first()
    await targetCard.scrollIntoViewIfNeeded()
    await targetCard.click()

    await expect(dialog).not.toBeVisible()

    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('incomplete')

    await page.goto('/workouts/')
    const sessionCard = page.locator('.workout-week li:has-text("Push day") .card').first()
    await expect(sessionCard).toHaveClass(/card-warning/)
  })

  test('saving the session form heals a session whose stored status is stale', async ({ page }) => {
    // Simulate a session that was bugged before the fix: all exercises fully
    // logged but status stored as 'incomplete'. Saving the form should heal it.
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    await writeSessionToIdb(page, {
      id: sessionId,
      programId: PUSH_DAY_PROGRAM_ID,
      status: 'incomplete',
      exercises
    })

    await page.goto(`/gymtime/?id=${sessionId}`)

    // Open the session form (it starts collapsed when a session exists) and save it
    const workoutDetails = page.locator('#workout-details')
    await workoutDetails.locator('summary').click()

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('completed')
  })
})
