import { test, expect, type Page } from '@playwright/test'
import { seedDatabase } from './seed'

test('missing program shows the load error', async ({ page }) => {
  await page.goto('/gymtime/?programId=non-existent')
  await expect(page.locator('.text-jim-error')).toHaveText(
    'Could not load workout. The program or session may no longer exist.'
  )
  await expect(page.getByRole('link', { name: 'Back to workouts' })).toBeVisible()
})

test.describe('Gymtime Page', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('a.program-link').first().click()
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test('logs a set, edits the weight, and adds an exercise', async ({ page }) => {
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    // The cards show before the save, but only a started workout takes a set.
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

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

  test("prefills last time's heaviest weight and says so when the weights differed", async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const exerciseId = await card.getAttribute('data-exercise-id')
    await page.evaluate(async (id) => {
      const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const exercise = await exercisesStore.getById(id ?? '')
      if (!exercise) throw new Error('exercise not seeded')
      let session = await workoutSessionsStore.create({
        date: '2020-01-01',
        programId: 'past',
        location: '',
        exercises: [snapshotFromExercise(exercise)]
      })
      for (const weight of [40, 50, 45]) {
        session = await workoutSessionsStore.addSet(session, id ?? '', { preset: 'lifting', reps: 8, weight })
      }
    }, exerciseId)

    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')
    await card.locator('.exercise-details > summary').click()

    const weight = card.locator('.next-set-form input[name="set-weight"]')
    await expect(weight).toHaveValue('50')
    await expect(weight).toHaveAccessibleDescription('Max last time')

    await weight.fill('47.5')
    await expect(card.locator('.set-field-note')).toHaveCount(0)
  })

  test('Break timer displays negative time when it passes 0:00', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

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

  test("moves an exercise from its card's actions menu", async ({ page }) => {
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

    const names = page.locator('.exercise-name')
    const [first, second] = (await names.allTextContents()).map((name) => name.trim())

    await page.getByRole('button', { name: `Actions for ${first}` }).click()
    const menu = page.locator('.exercise-actions-menu:popover-open')
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeHidden()
    await menu.getByRole('button', { name: 'Move down' }).click()

    await expect(names.nth(0)).toHaveText(second)
    await expect(names.nth(1)).toHaveText(first)
    await expect(menu).toHaveCount(0)

    await page.getByRole('button', { name: `Actions for ${first}` }).click()
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('draws the history chart, which loads Chart.js when the dialog opens', async ({ page }) => {
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.locator('summary').click()
    const chartDialog = page.locator('#exercise-history-dialog')
    const chartDrawn = page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#exercise-history-chart')
      return canvas !== null && canvas.width > 0 && canvas.hasAttribute('style')
    })
    await firstExercise.locator('.view-history-btn').click()
    await expect(chartDialog).toBeVisible()
    await chartDrawn

    await chartDialog.locator('.close-dialog-btn').click()
    await expect(chartDialog).toBeHidden()
  })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`the set that finishes an exercise closes its card, form and all (reduced motion: ${reducedMotion})`, async ({
      page
    }) => {
      // animateDetails reads the preference when a card is built, so the page loads again with it.
      await page.emulateMedia({ reducedMotion })
      await page.reload()
      await page.getByRole('button', { name: 'Save & start workout' }).click()
      await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

      const card = page.locator('#exercises-list > .card').first()
      const details = card.locator('.exercise-details')
      const form = card.locator('.next-set-form')
      const pending = card.locator('.completed-sets .set.isPending')
      const breakTimer = page.locator('#break-countdown-dialog')
      const logSet = async () => {
        await form.locator('input[name="set-reps"]').fill('10')
        await form.locator('input[name="set-weight"]').fill('100')
        await form.getByRole('button', { name: 'Finished set' }).click()
      }

      await details.locator('summary').click()
      await expect(form).toBeVisible()
      for (let left = await pending.count(); left > 1; left--) {
        await logSet()
        await expect(pending).toHaveCount(left - 1)
        await breakTimer.getByRole('button', { name: 'Skip' }).click()
        await expect(breakTimer).toBeHidden()
      }

      // Records each card's close animation as it starts: the height it starts from, and whether the card still shows
      // the next set's form then.
      await page.evaluate(() => {
        const closes: Array<{ from: number; formShown: boolean }> = []
        Reflect.set(window, '__closes', closes)
        const animate = Element.prototype.animate
        Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
          const frames = Array.isArray(args[0]) ? args[0] : []
          if (this.matches('.exercise-details-content') && frames.at(-1)?.height === '0px') {
            closes.push({
              from: parseFloat(String(frames[0]?.height)),
              formShown: !this.querySelector('.next-set')?.classList.contains('hidden')
            })
          }
          return animate.apply(this, args)
        }
      })
      const fullHeight = await card
        .locator('.exercise-details-content')
        .evaluate((content) => content.getBoundingClientRect().height)

      await logSet()
      await expect(details).toHaveJSProperty('open', false)
      await expect(card).toHaveClass(/card-success/)
      await expect(card.locator('.next-set')).toHaveClass(/hidden/)
      const closes = (await page.evaluate(() => Reflect.get(window, '__closes'))) as Array<{
        from: number
        formShown: boolean
      }>
      if (reducedMotion === 'reduce') {
        expect(closes).toEqual([])
      } else {
        expect(closes).toEqual([{ from: expect.closeTo(fullHeight, 0), formShown: true }])
      }
    })
  }

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
    await seedDatabase(page)
  })

  async function startSessionWith(page: Page, exerciseName: string) {
    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

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
