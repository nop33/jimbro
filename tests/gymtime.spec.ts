import { test, expect, type Page } from '@playwright/test'

test('missing program shows the load error', async ({ page }) => {
  await page.goto('/gymtime/?programId=non-existent')
  await expect(page.locator('.text-jim-error')).toHaveText(
    'Could not load workout. The program or session may no longer exist.'
  )
  await expect(page.getByRole('link', { name: 'Back to workouts' })).toBeVisible()
})

test.describe('Gymtime Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('a.program-link').first().click()
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test('logs a set, edits the weight, and adds an exercise', async ({ page }) => {
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.locator('summary').click() // Expand the details

    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await expect(finishBtn).toBeVisible()
    await expect(finishBtn).toBeEnabled()
    await finishBtn.click()

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await expect(breakTimer).not.toBeVisible()

    // The list also contains pending placeholders that do not open edit dialog.
    const completedSetItem = firstExercise.locator('.completed-sets .set.isCompleted').first()
    await expect(completedSetItem).toBeVisible()
    await expect(completedSetItem).toContainText('10')
    await expect(completedSetItem).toContainText('100')
    await expect(completedSetItem).toContainText('kg')

    // 5. Edit the completed set
    await completedSetItem.scrollIntoViewIfNeeded()
    await completedSetItem.click()

    const editSetDialog = page.locator('#edit-set-dialog')
    await expect(editSetDialog).toBeVisible()

    // Verify "X" button works
    await editSetDialog.locator('.close-dialog-btn').click()
    await expect(editSetDialog).not.toBeVisible()

    await completedSetItem.click()
    await expect(editSetDialog).toBeVisible()

    await editSetDialog.locator('input[name="set-weight"]').fill('105')
    await editSetDialog.getByRole('button', { name: 'Save' }).click()

    // Verify changes are saved (the weight span is inside the set)
    await expect(completedSetItem.locator('.set-weight')).toContainText('105')

    // 6. Add exercise on the fly
    const addExerciseCard = page.locator('#add-exercise-card')
    await addExerciseCard.scrollIntoViewIfNeeded()
    await addExerciseCard.click()

    const addExerciseDialog = page.locator('#add-exercise-dialog')
    await expect(addExerciseDialog).toBeVisible()

    // Verify "X" button works
    await addExerciseDialog.locator('.close-dialog-btn').click()
    await expect(addExerciseDialog).not.toBeVisible()

    await addExerciseCard.click()
    await expect(addExerciseDialog).toBeVisible()

    const dialogExercises = addExerciseDialog.locator('.card.card-hover')
    const firstDialogExercise = dialogExercises.first()
    const newExerciseName = (await firstDialogExercise.locator('.exercise-name').textContent())?.trim()
    if (!newExerciseName) throw new Error('exercise name missing')

    await firstDialogExercise.click()

    await expect(addExerciseDialog).not.toBeVisible()
    await expect(page.locator('#exercises-list')).toContainText(newExerciseName)
  })

  test('Break timer displays negative time when it passes 0:00', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    // Install clock to manipulate time
    await page.clock.install()

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.locator('summary').click() // Expand the details

    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await expect(finishBtn).toBeVisible()
    await expect(finishBtn).toBeEnabled()
    await finishBtn.click()

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    await page.clock.fastForward(149_000)
    await page.clock.fastForward(1_000)

    await expect(breakTimer).toBeVisible()
    await expect(breakTimer.locator('#countdown')).toContainText('0:00')

    // 7. Fast forward past the 1500ms timeout
    await page.clock.fastForward(1600)

    // 8. Verify the timer automatically closed
    await expect(breakTimer).toBeHidden()
  })

  test('a card opened while the cards re-render stays open', async ({ page }) => {
    const firstExercise = page.locator('details.exercise-details').first()
    await expect(firstExercise).toBeVisible()
    // Hold the re-render that starting the workout triggers at its first lookup, after it has begun.
    await page.evaluate(async () => {
      const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const lookup = workoutSessionsStore.getLatestWorkoutSessionWithCompletedExercise.bind(workoutSessionsStore)
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      Reflect.set(window, '__releaseRender', release)
      workoutSessionsStore.getLatestWorkoutSessionWithCompletedExercise = async (...args) => {
        Reflect.set(window, '__renderHeld', true)
        await gate
        return lookup(...args)
      }
    })

    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await page.waitForFunction(() => Reflect.get(window, '__renderHeld') === true)
    await firstExercise.locator('summary').click()
    await page.evaluate(() => (Reflect.get(window, '__releaseRender') as () => void)())
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

    await expect(firstExercise).toHaveJSProperty('open', true)
    await expect(firstExercise.locator('.next-set-form')).toBeVisible()
  })

  test('a set logged while the page rereads its session stays on screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')
    const card = page.locator('#exercises-list > .card').first()
    await card.locator('.exercise-details > summary').click()
    const form = card.locator('.next-set-form')
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')

    // Hold the reread once its read is done, and park the set's write behind a busy transaction, so the tap
    // changes the session in memory after the read and before the write lands.
    await page.evaluate(async () => {
      const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const { storage } = await import('/src/db/storage.ts')
      const read = workoutSessionsStore.getWorkoutSession.bind(workoutSessionsStore)
      let releaseRead = () => {}
      const readHeld = new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      workoutSessionsStore.getWorkoutSession = async (id) => {
        const session = await read(id)
        Reflect.set(window, '__readDone', true)
        await readHeld
        return session
      }
      Reflect.set(window, '__releaseRead', async () => {
        releaseRead()
        // Resolves once the reread has compared what it read.
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const db = await storage.connection()
      Reflect.set(window, '__holdWrites', () => {
        const tx = db.transaction(['workoutSessions', 'sets', 'setGroups', 'outbox', 'meta'], 'readwrite')
        const meta = tx.objectStore('meta')
        let held = true
        const spin = () => {
          if (held) meta.get('cursor').onsuccess = spin
        }
        spin()
        Reflect.set(window, '__releaseWrites', () => {
          held = false
        })
      })
    })

    // Another tab's notice makes the page reread its session.
    await page.evaluate(() => new BroadcastChannel('jimbro').postMessage('sync-settled'))
    await page.waitForFunction(() => Reflect.get(window, '__readDone') === true)
    const before = await page.locator('#exercises-list > .card').elementHandles()
    await page.evaluate(() => (Reflect.get(window, '__holdWrites') as () => void)())
    await form.getByRole('button', { name: 'Finished set' }).click()
    await page.evaluate(() => (Reflect.get(window, '__releaseRead') as () => Promise<void>)())
    await page.evaluate(() => (Reflect.get(window, '__releaseWrites') as () => void)())

    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()
    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    // A rebuild from the stale read lands after the write, so give it time to show up.
    await page.waitForTimeout(1000)

    await expect(card.locator('.completed-sets .set.isCompleted')).toHaveCount(1)
    const sameCards = await page.evaluate((nodes) => {
      const now = [...document.querySelectorAll('#exercises-list > .card')]
      return now.length === nodes.length && now.every((node, index) => node === nodes[index])
    }, before)
    expect(sameCards).toBe(true)
  })

  test('prefills location from the latest saved workout when starting a new session', async ({ page }) => {
    await page.locator('input[name="location"]').fill('Memorial Gym')
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

    await page.locator('#back-button').click()
    await expect(page).toHaveURL(/\/workouts\//)

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await dialog.locator('a.program-link').nth(1).click()
    await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)

    await expect(page.locator('input[name="location"]')).toHaveValue('Memorial Gym')
  })
})

test.describe('Gymtime Page: non-lifting presets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()
  })

  async function startSessionWith(page: Page, exerciseName: string) {
    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    await page.locator('#add-exercise-card').click()
    const addExerciseDialog = page.locator('#add-exercise-dialog')
    await expect(addExerciseDialog).toBeVisible()
    await addExerciseDialog.locator('.card', { hasText: exerciseName }).first().click()
    await expect(addExerciseDialog).not.toBeVisible()

    const card = page.locator('#exercises-list .card', { hasText: exerciseName }).first()
    await expect(card).toBeVisible()
    await card.locator('.exercise-details summary').click()
    return card
  }

  test('logs a treadmill set in minutes, speed and incline', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Treadmill walk')
    await page.getByLabel('Kind').selectOption('cardio')
    await page.getByLabel('Default sets').fill('1')
    await expect(page.getByLabel('Default time (min)')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Exercise saved')

    const card = await startSessionWith(page, 'Treadmill walk')
    const setForm = card.locator('.next-set-form')

    await expect(setForm.locator('input[name="set-durationSec"]')).toHaveValue('')
    await expect(setForm.locator('input[name="set-speed"]')).toHaveValue('')
    await expect(setForm.locator('input[name="set-incline"]')).toHaveValue('0')
    await expect(setForm.locator('input[name="set-reps"]')).toHaveCount(0)

    await setForm.locator('input[name="set-durationSec"]').fill('20')
    await setForm.locator('input[name="set-speed"]').fill('5.5')
    await setForm.getByRole('button', { name: 'Finished set' }).click()

    const completedSet = card.locator('.completed-sets .set.isCompleted').first()
    await expect(completedSet).toBeVisible()
    await expect(completedSet.locator('.set-durationSec')).toHaveText('20')
    await expect(completedSet.locator('.set-speed')).toHaveText('5.5')
    await expect(completedSet.locator('.set-incline')).toHaveText('0')
    await expect(completedSet).toContainText('min')
    await expect(completedSet).toContainText('km/h')
    await expect(completedSet).toContainText('%')

    await expect(card.getByRole('button', { name: 'View History' })).toBeHidden()
  })

  test('logs a rehab hold set and skips the break timer', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Side plank')
    await page.getByLabel('Kind').selectOption('rehab')
    await page.getByLabel('Log as').selectOption({ label: 'Hold' })
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Core' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default hold (sec)').fill('30')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Exercise saved')

    const card = await startSessionWith(page, 'Side plank')
    const setForm = card.locator('.next-set-form')

    await expect(setForm.locator('input[name="set-durationSec"]')).toHaveValue('30')
    await setForm.getByRole('button', { name: 'Finished set' }).click()

    const completedSet = card.locator('.completed-sets .set.isCompleted').first()
    await expect(completedSet.locator('.set-durationSec')).toHaveText('30')

    await expect(page.locator('#break-countdown-dialog')).toBeHidden()
  })
})
