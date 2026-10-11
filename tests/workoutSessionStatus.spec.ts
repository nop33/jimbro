import { test, expect, type Page } from '@playwright/test'
import type { ExerciseSnapshot, SessionHeader, SetRow } from '../src/db/types'
import { seedDatabase } from './seed'

/**
 * These tests verify that the workout session status stays in sync with the
 * actual completion state of its exercises, even when the user mutates the
 * exercise list (delete / add) rather than logging a last set.
 *
 * Setup stores the session straight through storage.writeRows (via
 * page.evaluate), status included, to skip the slow path of logging every set
 * through the UI. The operation under test still goes through the real UI ->
 * state layer -> IDB path, which is what we care about.
 */

// Push day program ID from src/db/stores/seed-programs.json
const PUSH_DAY_PROGRAM_ID = '07c50b23-d3ad-4c30-a4a9-d8bdf58a2300'

// A seeded exercise that is NOT part of Push Day (it's in Pull Day).
// We use its name to locate the card in the AddExerciseDialog.
const EXERCISE_NOT_IN_PUSH_DAY = {
  id: '17208184-8e68-4acf-9709-643305c1ac3e',
  name: 'Pull down machine'
}

type SeedSessionExercise = ExerciseSnapshot & { sets: Array<SetRow['set']> }

interface SeedSessionInput {
  id: string
  programId: string
  status: SessionHeader['status']
  exercises: Array<SeedSessionExercise>
}

// Stores the session dated today as given, its status included, so a test can start from a stale one.
const writeSession = (page: Page, session: SeedSessionInput) =>
  page.evaluate(async ({ id, programId, status, exercises }) => {
    const { storage } = await import('/src/db/storage.ts')
    const { getSimpleDate } = await import('/src/dateUtils.ts')
    const updatedAt = new Date().toISOString()
    await storage.writeRows([
      {
        table: 'sessions',
        row: {
          id,
          date: getSimpleDate(new Date()),
          programId,
          location: '',
          status,
          notes: '',
          exercises: exercises.map(({ sets: _sets, ...snapshot }) => snapshot),
          isDeleted: false,
          updatedAt
        }
      },
      ...exercises.flatMap(({ exerciseId, sets }) =>
        sets.map((set, position) => ({
          table: 'sets' as const,
          row: {
            id: `${id}:${exerciseId}:${position}`,
            sessionId: id,
            exerciseId,
            position,
            set,
            isDeleted: false,
            updatedAt
          }
        }))
      )
    ])
  }, session)

const readSessionStatus = (page: Page, sessionId: string) =>
  page.evaluate(async (id) => {
    const { storage } = await import('/src/db/storage.ts')
    return (await storage.get<SessionHeader>('workoutSessions', id))?.status
  }, sessionId)

// The program's exercises as a session snapshots them, each with its target sets logged.
const buildCompletedExercisesFor = (page: Page, programId: string): Promise<Array<SeedSessionExercise>> =>
  page.evaluate(async (id) => {
    const { programsStore } = await import('/src/db/stores/programsStore.ts')
    const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
    const { snapshotFromExercise } = await import('/src/db/stores/workoutSessionsStore.ts')
    const program = await programsStore.getById(id)
    if (!program) throw new Error(`Program ${id} missing from seeded DB`)
    return Promise.all(
      program.exercises.map(async (exerciseId) => {
        const exercise = await exercisesStore.getById(exerciseId)
        if (!exercise) throw new Error(`Exercise ${exerciseId} missing from seeded DB`)
        const set = { preset: 'lifting' as const, reps: exercise.defaults.reps ?? 8, weight: 50 }
        return { ...snapshotFromExercise(exercise), sets: Array.from({ length: exercise.targetSets }, () => set) }
      })
    )
  }, programId)

test.describe('Workout session status reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
  })

  test('deleting the last incomplete exercise transitions the session to completed', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    // Empty the last exercise so the session is legitimately incomplete
    const lastExerciseId = exercises[exercises.length - 1].exerciseId
    exercises[exercises.length - 1].sets = []

    await writeSession(page, {
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
    await lastCard.locator('.exercise-actions-btn').click()
    // Completing the workout without cloud backup downloads a JSON export. Leaving the page before it starts can
    // stall the next navigation in WebKit, so the test waits for it.
    const exportDownload = page.waitForEvent('download')
    await lastCard.locator('.delete-workout-session-exercise-btn').click()

    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('completed')
    await exportDownload

    await page.goto('/workouts/')
    const sessionCard = page.locator('.workout-week li:has-text("Push day") .card').first()
    await expect(sessionCard).toHaveClass(/card-success/)
  })

  test('adding an exercise to a completed session transitions it back to incomplete', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    await writeSession(page, {
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

  test('the workout celebrates each time it goes from incomplete to completed', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)
    const last = exercises[exercises.length - 1]
    last.sets = last.sets.slice(1)

    await writeSession(page, { id: sessionId, programId: PUSH_DAY_PROGRAM_ID, status: 'incomplete', exercises })
    await page.goto(`/gymtime/?id=${sessionId}`)
    await page.evaluate(() => {
      Reflect.set(window, '__workoutsDone', 0)
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.querySelector('.confetti-text')?.textContent === 'Workout done!') {
              Reflect.set(window, '__workoutsDone', (Reflect.get(window, '__workoutsDone') as number) + 1)
            }
          }
        }
      }).observe(document.body, { childList: true })
    })
    const workoutsDone = () => page.evaluate(() => Reflect.get(window, '__workoutsDone') as number)

    const lastCard = page.locator(`[data-exercise-id="${last.exerciseId}"]`)
    await lastCard.scrollIntoViewIfNeeded()
    await lastCard.locator('.exercise-details > summary').click()
    await lastCard.getByRole('button', { name: 'Finished set' }).click()
    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('completed')
    await expect.poll(workoutsDone).toBe(1)

    await lastCard.locator('.exercise-details > summary').click()
    await lastCard.getByRole('button', { name: 'Add set' }).click()
    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('incomplete')

    await lastCard.getByRole('button', { name: 'Finished set' }).click()
    await expect.poll(() => readSessionStatus(page, sessionId)).toBe('completed')
    await expect.poll(workoutsDone).toBe(2)
  })

  test('saving the session form heals a session whose stored status is stale', async ({ page }) => {
    // Simulate a session that was bugged before the fix: all exercises fully
    // logged but status stored as 'incomplete'. Saving the form should heal it.
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)

    await writeSession(page, {
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
