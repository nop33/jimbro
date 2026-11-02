import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
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

    // The workout completes, which downloads its export.
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
    // The page wires Add exercise before it draws the cards, so a tap before the first card shows does nothing.
    await expect(page.locator('#exercises-list > .card').first()).toBeVisible()

    const addExerciseCard = page.locator('#add-exercise-card')
    await addExerciseCard.scrollIntoViewIfNeeded()
    await addExerciseCard.click()

    const dialog = page.locator('#add-exercise-dialog')
    await expect(dialog).toBeVisible()

    const targetCard = dialog.locator(`.card:has-text("${EXERCISE_NOT_IN_PUSH_DAY.name}")`).first()
    await targetCard.scrollIntoViewIfNeeded()
    await targetCard.click()

    await expect(dialog).not.toBeVisible()
    await expect(page.locator(`[data-exercise-id="${EXERCISE_NOT_IN_PUSH_DAY.id}"]`)).toBeVisible()

    await page.goto('/workouts/')
    const sessionCard = page.locator('.workout-week li:has-text("Push day") .card').first()
    await expect(sessionCard).toHaveClass(/card-warning/)
  })

  test('the workout celebrates each time it goes from incomplete to completed, and exports once a week', async ({
    page
  }) => {
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
    let downloads = 0
    page.on('download', () => downloads++)

    const lastCard = page.locator(`[data-exercise-id="${last.exerciseId}"]`)
    await lastCard.scrollIntoViewIfNeeded()
    await lastCard.locator('.exercise-details > summary').click()
    await lastCard.getByRole('button', { name: 'Finished set' }).click()
    await expect.poll(workoutsDone).toBe(1)

    await lastCard.locator('.exercise-details > summary').click()
    await lastCard.getByRole('button', { name: 'Add set' }).click()
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')

    await lastCard.getByRole('button', { name: 'Finished set' }).click()
    await expect.poll(workoutsDone).toBe(2)

    // Without cloud backup the first finish downloads a JSON export, and the second, within the week, doesn't.
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')
    expect(downloads).toBe(1)
  })

  test('the set that finishes the workout ends a minimized break', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)
    const last = exercises[exercises.length - 1]
    last.sets = last.sets.slice(2)

    await writeSession(page, { id: sessionId, programId: PUSH_DAY_PROGRAM_ID, status: 'incomplete', exercises })
    // Records the vibration patterns, which the haptic feedback on every tap also sends as a bare number.
    await page.addInitScript(() => {
      const patterns: Array<number | Array<number>> = []
      Object.assign(window, { vibrations: patterns })
      Object.defineProperty(navigator, 'vibrate', {
        value: (pattern: number | Array<number>) => patterns.push(pattern) > 0
      })
    })
    await page.goto(`/gymtime/?id=${sessionId}`)

    const lastCard = page.locator(`[data-exercise-id="${last.exerciseId}"]`)
    const finishedSet = lastCard.getByRole('button', { name: 'Finished set' })
    const breakTimer = page.locator('#break-countdown-dialog')
    await lastCard.scrollIntoViewIfNeeded()
    await lastCard.locator('.exercise-details > summary').click()
    await finishedSet.click()
    await expect(breakTimer).toBeVisible()
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)

    // Completing the workout without cloud backup downloads a JSON export, which the test waits for.
    const exportDownload = page.waitForEvent('download')
    await finishedSet.click()
    await expect(page.locator('.confetti-text')).toHaveText('Workout done!')
    await expect(breakTimer).toBeHidden()
    await exportDownload
    // Finishing the workout vibrates with its own longer pattern.
    const patterns = await page.evaluate(
      () => (window as unknown as { vibrations: Array<number | Array<number>> }).vibrations
    )
    expect(patterns.filter(Array.isArray)).toEqual([[60, 40, 60, 40, 60, 80, 400]])
  })
})

test.describe('Celebrations', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
  })

  // A workout whose first exercise is a set short and whose second has no sets, so the first card's set finishes an
  // exercise, not the workout.
  const openWithOneSetLeft = async (page: Page) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)
    const [first, second] = exercises
    first.sets = first.sets.slice(1)
    second.sets = []
    await writeSession(page, { id: sessionId, programId: PUSH_DAY_PROGRAM_ID, status: 'incomplete', exercises })
    await page.goto(`/gymtime/?id=${sessionId}`)
    const card = page.locator(`[data-exercise-id="${first.exerciseId}"]`)
    await card.locator('.exercise-details > summary').click()
    return card
  }

  test('finishing an exercise bursts confetti from its card, then clears it', async ({ page }) => {
    const card = await openWithOneSetLeft(page)
    // Where the card's corner is when the burst starts, kept on screen like the burst, since logging the set can
    // scroll the page on a short phone.
    await card.evaluate((element) => {
      new MutationObserver((records, observer) => {
        if (
          !records.some((record) =>
            [...record.addedNodes].some((node) => node instanceof HTMLElement && node.matches('.confetti'))
          )
        )
          return
        observer.disconnect()
        const box = element.getBoundingClientRect()
        const clamp = (value: number, max: number) => Math.min(Math.max(value, 16), max - 16)
        Reflect.set(window, '__corner', { x: clamp(box.right, innerWidth), y: clamp(box.top, innerHeight) })
      }).observe(document.body, { childList: true })
    })
    await card.getByRole('button', { name: 'Finished set' }).click()

    await expect(page.locator('.confetti:popover-open .confetti-text')).toHaveText('Exercise done!')
    await expect(page.locator('.confetti-piece').first()).toBeAttached()
    const corner = await page.evaluate(() => Reflect.get(window, '__corner') as { x: number; y: number })
    // Every piece starts at the card's top right corner, where its done check appears.
    const starts = await page.locator('.confetti-piece').evaluateAll((pieces) =>
      pieces.map((piece) => {
        const effect = piece.getAnimations()[0].effect as KeyframeEffect
        const [x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/
          .exec(String(effect.getKeyframes()[0].transform))!
          .slice(1)
        return { x: Number(x), y: Number(y) }
      })
    )
    for (const start of starts) {
      expect(Math.abs(start.x - corner.x)).toBeLessThan(10)
      expect(Math.abs(start.y - corner.y)).toBeLessThan(10)
    }
    // The message fades out with the pieces, and the layer leaves once they have.
    await expect(page.locator('.confetti')).toHaveCount(0)
  })

  test('finishing the workout stamps the message with rings and no confetti', async ({ page }) => {
    const sessionId = crypto.randomUUID()
    const exercises = await buildCompletedExercisesFor(page, PUSH_DAY_PROGRAM_ID)
    const last = exercises[exercises.length - 1]
    last.sets = last.sets.slice(1)
    await writeSession(page, { id: sessionId, programId: PUSH_DAY_PROGRAM_ID, status: 'incomplete', exercises })
    await page.goto(`/gymtime/?id=${sessionId}`)
    const lastCard = page.locator(`[data-exercise-id="${last.exerciseId}"]`)
    await lastCard.scrollIntoViewIfNeeded()
    await lastCard.locator('.exercise-details > summary').click()
    const exportDownload = page.waitForEvent('download')
    await lastCard.getByRole('button', { name: 'Finished set' }).click()

    await expect(page.locator('.confetti:popover-open .confetti-text')).toHaveText('Workout done!')
    await expect(page.locator('.confetti-ring')).toHaveCount(2)
    await expect(page.locator('.confetti-piece')).toHaveCount(0)
    await exportDownload
    await expect(page.locator('.confetti')).toHaveCount(0)
  })

  test('under reduced motion only the message shows', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const card = await openWithOneSetLeft(page)
    await card.getByRole('button', { name: 'Finished set' }).click()

    await expect(page.locator('.confetti-text')).toHaveText('Exercise done!')
    await expect(page.locator('.confetti-piece')).toHaveCount(0)
    await expect(page.locator('.confetti')).toHaveCount(0)
  })
})
