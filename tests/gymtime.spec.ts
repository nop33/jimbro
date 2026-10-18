import { test, expect, type Page } from '@playwright/test'
import { seedDatabase } from './seed'
import { startWorkout } from './startWorkout'

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
    // The first set starts the workout.
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await expect(breakTimer).not.toBeVisible()

    // The list also contains pending placeholders that do not open edit dialog.
    const completedSetItem = firstExercise.locator('.completed-sets .set.isCompleted').first()
    await expect(completedSetItem.locator('.set-reps')).toHaveText('10')
    await expect(completedSetItem.locator('.set-weight')).toHaveText('100')
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
    // The set's values fill the form, so the title takes the focus and no keyboard opens over them.
    await expect(editSetDialog.getByRole('heading', { name: 'Edit set' })).toBeFocused()

    await editSetDialog.locator('input[name="set-weight"]').fill('105')
    await editSetDialog.getByRole('button', { name: 'Save' }).click()

    // Verify changes are saved (the weight span is inside the set)
    await expect(completedSetItem.locator('.set-weight')).toHaveText('105')

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
    await expect(addExerciseDialog.getByRole('heading', { name: 'Add exercise' })).toBeFocused()

    const cardNames = page.locator('#exercises-list > .card .exercise-name')
    const cardsBefore = await cardNames.count()
    const dialogExercises = addExerciseDialog.locator('.card.card-hover')
    const firstDialogExercise = dialogExercises.first()
    const newExerciseName = (await firstDialogExercise.locator('.exercise-name').textContent())?.trim()
    if (!newExerciseName) throw new Error('exercise name missing')

    await firstDialogExercise.click()

    await expect(addExerciseDialog).not.toBeVisible()
    await expect(cardNames).toHaveCount(cardsBefore + 1)
    await expect(cardNames.last()).toHaveText(newExerciseName)
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
    // The page reads last time once, so it loads again to see the workout just stored.
    await page.reload()

    await card.locator('.exercise-details > summary').click()

    const weight = card.locator('.next-set-form input[name="set-weight"]')
    await expect(weight).toHaveValue('50')
    await expect(weight).toHaveAccessibleDescription('Heaviest set last time: 50 kg')

    const badge = card.getByRole('button', { name: 'Max' })
    await badge.click()
    await expect(card.getByText('Heaviest set last time: 50 kg')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card.getByText('Heaviest set last time: 50 kg')).toBeHidden()

    await weight.fill('47.5')
    await expect(badge).toHaveCount(0)
    await expect(weight).not.toHaveAttribute('aria-describedby')
  })

  test('the break shows 0:00 for a second and closes itself before it would show -0:01', async ({ page }) => {
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

    // The 2:30 break reaches 0:00, keeps it on screen for a second like every other number, and closes when -0:01 would
    // show. The clock stops at each point until the test runs it on.
    const countdown = breakTimer.locator('#countdown')
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 150_000)
    await expect(countdown).toHaveText('0:00')
    await page.clock.runFor(999)
    await expect(countdown).toHaveText('0:00')
    await expect(breakTimer).toBeVisible()
    await page.clock.runFor(1)
    await expect(breakTimer).toBeHidden()
  })

  test('a set logged from a minimized break starts a fresh break that the last one cannot close', async ({ page }) => {
    await page.clock.install()

    const card = page.locator('#exercises-list > .card').first()
    const form = card.locator('.next-set-form')
    const logSet = async () => {
      await form.locator('input[name="set-reps"]').fill('10')
      await form.locator('input[name="set-weight"]').fill('100')
      await form.getByRole('button', { name: 'Finished set' }).click()
    }
    const breakTimer = page.locator('#break-countdown-dialog')
    const countdown = breakTimer.locator('#countdown')
    await card.locator('.exercise-details > summary').click()
    await logSet()
    await expect(breakTimer).toBeVisible()

    // The break reaches 0:00 and is about to close itself, a second later. The clock stops there until the test runs it.
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 150_000)
    await expect(countdown).toHaveText('0:00')
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)

    // The next set starts the next break before then, and that break outlives the last one's close.
    await logSet()
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    await expect(breakTimer.locator('#sets-done')).toHaveText('2 / 4')
    await expect(countdown).toHaveText('2:30')
    await page.clock.runFor(2_500)
    await expect(breakTimer).toBeVisible()
    await expect(countdown).toHaveText('2:28')
  })

  test("moves an exercise from its card's actions menu, which starts the workout", async ({ page }) => {
    const names = page.locator('.exercise-name')
    await expect(names.first()).toBeVisible()
    const [first, second] = (await names.allTextContents()).map((name) => name.trim())

    await page.getByRole('button', { name: `Actions for ${first}` }).click()
    const menu = page.locator('.exercise-actions-menu:popover-open')
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeHidden()
    await menu.getByRole('button', { name: 'Move down' }).click()

    await expect(names.nth(0)).toHaveText(second)
    await expect(names.nth(1)).toHaveText(first)
    await expect(menu).toHaveCount(0)
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)

    await page.getByRole('button', { name: `Actions for ${first}` }).click()
    await expect(menu.getByRole('button', { name: 'Move up' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })

  test('draws the history chart, which loads Chart.js when the dialog opens', async ({ page }) => {
    const chartRequests: string[] = []
    page.on('request', (request) => {
      if (/chart(\.|_+)js/i.test(request.url())) chartRequests.push(request.url())
    })
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.locator('summary').click()
    expect(chartRequests).toEqual([])
    const chartDialog = page.locator('#exercise-history-dialog')
    const chartDrawn = page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#exercise-history-chart')
      return canvas !== null && canvas.width > 0 && canvas.hasAttribute('style')
    })
    await firstExercise.locator('.view-history-btn').click()
    await expect(chartDialog).toBeVisible()
    await chartDrawn
    expect(chartRequests).not.toEqual([])

    await chartDialog.locator('.close-dialog-btn').click()
    await expect(chartDialog).toBeHidden()
  })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`the set that finishes an exercise closes its card, form and all (reduced motion: ${reducedMotion})`, async ({
      page
    }) => {
      // animateDetails reads the preference when a card is built, so the page loads again with it. The reload waits
      // for the first load to show its cards and day, which come from its database reads.
      await expect(page.locator('#exercises-list > .card').first()).toBeVisible()
      await expect(page.locator('#workout-date-label')).toHaveText('Today')
      await page.emulateMedia({ reducedMotion })
      await page.reload()

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

  test('opening a program saves nothing until the first change starts the workout', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const rows = card.locator('.completed-sets > .set')
    await expect(page.locator('#workout-date-label')).toHaveText('Today')
    await card.locator('.exercise-details > summary').click()
    const planned = await rows.count()
    await expect(page.locator('#delete-workout-session-btn')).toBeHidden()
    // The workouts page, open beside it, lists a started workout as incomplete.
    const workouts = await page.context().newPage()
    await workouts.goto('/workouts/')
    await expect(workouts.locator('.workout-week').first()).toBeVisible()
    await expect(workouts.locator('.workout-week .card-warning')).toHaveCount(0)

    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(rows).toHaveCount(planned + 1)
    await expect(page.locator('#delete-workout-session-btn')).toBeVisible()
    await workouts.reload()
    await expect(workouts.locator('.workout-week .card-warning')).toHaveCount(1)

    // After the start, the details save as they change.
    await page.locator('#workout-details > summary').click()
    await page.locator('textarea[name="notes"]').fill('Felt strong')
    await page.locator('textarea[name="notes"]').blur()
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')
    await page.reload()
    await expect(page.locator('textarea[name="notes"]')).toHaveValue('Felt strong')
  })

  test('removes a set to do from its menu, and a logged set from Edit set', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const pending = card.locator('.completed-sets .set.isPending')
    const logged = card.locator('.completed-sets .set.isCompleted')
    await card.locator('.exercise-details > summary').click()
    const total = await pending.count()

    await card.locator('input[name="set-reps"]').fill('10')
    await card.locator('input[name="set-weight"]').fill('100')
    await card.getByRole('button', { name: 'Finished set' }).click()
    await page.locator('#break-countdown-dialog').getByRole('button', { name: 'Skip' }).click()
    await expect(logged).toHaveCount(1)

    await card.getByRole('button', { name: `Set ${total}, to do` }).click()
    await page.getByRole('button', { name: `Remove set ${total}` }).click()
    await expect(pending).toHaveCount(total - 2)

    // Removing the rest finishes the exercise.
    for (let left = total - 2; left > 0; left--) {
      await card
        .getByRole('button', { name: /, to do$/ })
        .last()
        .click()
      await page.getByRole('button', { name: /^Remove set/ }).click()
      await expect(pending).toHaveCount(left - 1)
    }
    await expect(card).toHaveClass(/card-success/)

    page.on('dialog', (dialog) => dialog.accept())
    await logged.first().click()
    await page.locator('#edit-set-dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Set deleted')
    await expect(logged).toHaveCount(0)
    await expect(pending).toHaveCount(1)
    await expect(card.getByRole('button', { name: 'Set 1, to do' })).toHaveCount(0)
  })

  test('prefills location from the latest saved workout when starting a new session', async ({ page }) => {
    await page.locator('#workout-details > summary').click()
    await page.locator('input[name="location"]').fill('Memorial Gym')
    await startWorkout(page)

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

    // Adding the exercise starts the workout.
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
