import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'
import { startWorkout } from './startWorkout'

test('missing program shows the load error', async ({ page }) => {
  await page.goto('/gymtime/?programId=non-existent')
  await expect(page.locator('.text-jim-error')).toHaveText(
    'Could not load workout. The program or session may no longer exist.'
  )
  await expect(page.getByRole('link', { name: 'Back to workouts' })).toBeVisible()
  // There is no workout to delete.
  await expect(page.locator('#delete-workout-session-btn')).toBeHidden()
})

test.describe('Gymtime Page', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('a.program-pick').first().click()
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test('logs a set, edits the weight, and adds an exercise', async ({ page }) => {
    // 2. Open the first exercise
    const firstExercise = page.locator('#exercises-list > .card').first()
    await firstExercise.locator('.exercise-open-btn').click() // Open its sheet

    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await expect(finishBtn).toBeVisible()
    await expect(finishBtn).toBeEnabled()
    await finishBtn.click()
    // The first set starts the workout. The toast sits below the header, clear of its back button and title.
    const toast = page.locator('.toast-message-popup')
    await expect(toast).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    const header = (await page.locator('.app-header').boundingBox())!
    const nav = (await page.locator('.bottom-nav').boundingBox())!
    await expect
      .poll(async () => {
        const box = (await toast.boundingBox())!
        return box.y >= header.y + header.height && box.y + box.height <= nav.y
      })
      .toBe(true)
    // A tap on it reaches the page under it, so it never swallows a tap meant for Finished set.
    expect(
      await toast.evaluate((popup) => {
        const { x, y, width, height } = popup.getBoundingClientRect()
        return popup.contains(document.elementFromPoint(x + width / 2, y + height / 2))
      })
    ).toBe(false)

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()
    // The toast is a popover the first set shows after it opens the break timer, so the top layer draws it above the
    // timer. A modal dialog makes the page under it inert, popovers included, so no hit test can see the order: the
    // tour's screenshot shows it.
    await expect(toast).toBeVisible()
    await expect(toast).toHaveJSProperty('popover', 'manual')
    expect(await toast.evaluate((popup) => popup.matches(':popover-open'))).toBe(true)

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
    await editSetDialog.getByRole('button', { name: 'Close dialog' }).click()
    await expect(editSetDialog).not.toBeVisible()

    await completedSetItem.click()
    await expect(editSetDialog).toBeVisible()
    // The set's values fill the form, so the title takes the focus and no keyboard opens over them.
    await expect(editSetDialog.getByRole('heading', { name: 'Edit set' })).toBeFocused()

    await editSetDialog.locator('input[name="set-weight"]').fill('105')
    await editSetDialog.getByRole('button', { name: 'Save' }).click()

    // Verify changes are saved (the weight span is inside the set)
    await expect(completedSetItem.locator('.set-weight')).toHaveText('105')

    // 6. Add exercises on the fly, from the list under the sheet
    await firstExercise.getByRole('button', { name: 'Close dialog' }).click()
    const addExerciseBtn = page.locator('#add-exercise-btn')
    await addExerciseBtn.scrollIntoViewIfNeeded()
    await addExerciseBtn.click()

    const picker = page.locator('#exercise-picker')
    await expect(picker).toBeVisible()

    // Verify "X" button works
    await picker.getByRole('button', { name: 'Close dialog' }).click()
    await expect(picker).not.toBeVisible()

    await addExerciseBtn.click()
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('heading', { name: 'Add exercises' })).toBeFocused()
    // The close button cancels, so the dialog has no Cancel.
    await expect(picker.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

    // The workout's exercises show ticked and can't be added again.
    const cardNames = page.locator('#exercises-list > .card .exercise-name')
    const inWorkout = (await cardNames.allTextContents()).map((name) => name.trim())
    await expect(picker.getByLabel(inWorkout[0])).toBeChecked()
    await expect(picker.getByLabel(inWorkout[0])).toBeDisabled()

    // The rest join the workout's end in the order ticked.
    const free = picker.locator('.exercise-choice:has(input:enabled) .exercise-choice-name')
    const [first, second] = (await free.allTextContents()).slice(0, 2).map((name) => name.trim())
    await picker.getByLabel(second, { exact: true }).check()
    await picker.getByLabel(first, { exact: true }).check()
    await picker.getByRole('button', { name: 'Add 2 exercises' }).click()

    await expect(picker).not.toBeVisible()
    await expect(cardNames).toHaveText([...inWorkout, second, first])
  })

  test('swaps an exercise for one picked from the same sheet, which offers none already in the workout', async ({
    page
  }) => {
    const cards = page.locator('#exercises-list > .card')
    await expect(cards.first()).toBeVisible()
    const names = (await cards.locator('.exercise-name').allTextContents()).map((name) => name.trim())

    await cards.first().locator('.exercise-actions-btn').click()
    await page.getByRole('button', { name: 'Swap exercise' }).click()
    const picker = page.locator('#exercise-picker')
    await expect(picker.getByRole('heading', { name: 'Swap exercise' })).toBeVisible()
    // A swap takes the one tapped, so there are no checkboxes and nothing to submit.
    await expect(picker.getByRole('checkbox')).toHaveCount(0)
    await expect(picker.getByRole('button', { name: /^Add/ })).toBeHidden()
    await expect(picker.getByRole('button', { name: names[1] })).toBeDisabled()

    const replacement = picker.locator('button.exercise-choice:enabled .exercise-choice-name').first()
    const replacementName = (await replacement.textContent())!.trim()
    await replacement.click()
    await expect(picker).toBeHidden()
    await expect(cards.locator('.exercise-name')).toHaveText([replacementName, ...names.slice(1)])
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

    await card.locator('.exercise-open-btn').click()

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

  test('prefills the most reps at the heaviest weight and says so when those reps differed', async ({ page }) => {
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
      for (const reps of [10, 8, 6]) {
        session = await workoutSessionsStore.addSet(session, id ?? '', { preset: 'lifting', reps, weight: 50 })
      }
    }, exerciseId)
    // The page reads last time once, so it loads again to see the workout just stored.
    await page.reload()

    await card.locator('.exercise-open-btn').click()

    const reps = card.locator('.next-set-form input[name="set-reps"]')
    await expect(reps).toHaveValue('10')
    await expect(reps).toHaveAccessibleDescription('Most reps last time at 50 kg: 10')
    // Every set was at 50 kg, so the weight has no pill.
    await expect(card.getByRole('button', { name: 'Max' })).toHaveCount(1)

    const badge = card.getByRole('button', { name: 'Max' })
    await badge.click()
    const details = card.getByText('Most reps last time at 50 kg: 10')
    await expect(details).toBeVisible()
    await expect(details).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()

    await reps.fill('9')
    await expect(badge).toHaveCount(0)
    await expect(reps).not.toHaveAttribute('aria-describedby')
  })

  test('Previous sets opens on last time and steps to older and newer workouts at any gym', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const exerciseId = await card.getAttribute('data-exercise-id')
    await page.evaluate(async (id) => {
      const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const exercise = await exercisesStore.getById(id ?? '')
      if (!exercise) throw new Error('exercise not seeded')
      for (const [date, location, weight] of [
        ['2020-01-01', 'Zurich', 40],
        ['2020-01-08', 'Athens', 45],
        ['2020-01-15', 'Zurich', 50]
      ] as const) {
        const session = await workoutSessionsStore.create({
          date,
          programId: 'past',
          location,
          exercises: [snapshotFromExercise(exercise)]
        })
        await workoutSessionsStore.addSet(session, id ?? '', { preset: 'lifting', reps: 8, weight })
      }
    }, exerciseId)
    // The page reads last time once, so it loads again to see the workouts just stored.
    await page.reload()

    await card.locator('.exercise-open-btn').click()
    await card.locator('.view-last-set-btn').click()
    const dialog = page.locator('#last-set-dialog')
    const date = dialog.locator('#last-set-date')
    const gym = dialog.locator('#last-set-gym')
    const sets = dialog.locator('#last-set-list')
    const older = dialog.locator('#last-set-older')
    const newer = dialog.locator('#last-set-newer')
    await expect(date).toHaveText(/Jan 15, 2020/)
    await expect(gym).toHaveText('in Zurich')
    await expect(sets).toContainText('50')
    await expect(newer).toBeDisabled()
    await expect(older).toHaveAccessibleName(/^Older workout, .*Jan 8, 2020 in Athens$/)

    await older.click()
    await expect(date).toHaveText(/Jan 8, 2020/)
    await expect(gym).toHaveText('in Athens')
    await expect(sets).toContainText('45')

    // From the keyboard, since WebKit does not focus a clicked button.
    await older.focus()
    await page.keyboard.press('Enter')
    await expect(date).toHaveText(/Jan 1, 2020/)
    await expect(sets).toContainText('40')
    await expect(older).toBeDisabled()
    await expect(newer).toBeFocused()

    await page.keyboard.press('ArrowRight')
    await expect(date).toHaveText(/Jan 8, 2020/)
    await expect(newer).toBeEnabled()
  })

  test('the break shows 0:00 for a second and closes itself before it would show -0:01', async ({ page }) => {
    // Install clock to manipulate time
    await page.clock.install()

    // 2. Open the first exercise
    const firstExercise = page.locator('#exercises-list > .card').first()
    await firstExercise.locator('.exercise-open-btn').click() // Open its sheet

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
    await card.locator('.exercise-open-btn').click()
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

  test('holding Finished set grows it into the room its sheet has left until the next hold, and a tap still logs the set', async ({
    page
  }) => {
    const cards = page.locator('#exercises-list > .card')
    const card = cards.first()
    const form = card.locator('.next-set-form')
    const finishBtn = form.getByRole('button', { name: 'Finished set' })
    const logged = card.locator('.completed-sets .set.isCompleted')
    const breakTimer = page.locator('#break-countdown-dialog')
    const viewport = page.viewportSize()!
    const height = async () => (await finishBtn.boundingBox())!.height
    await card.locator('.exercise-open-btn').click()
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')
    const normalHeight = await height()
    // Grown, the button takes what the sheet has left once it shows every set, so the sets never scroll because of it.
    const grownInRoom = (button = finishBtn) =>
      expect
        .poll(() =>
          button.evaluate((element: HTMLElement, normal) => {
            const sheet = element.closest('dialog')!
            const body = sheet.querySelector('.exercise-sheet-body')!
            return {
              setsScroll: body.scrollHeight > body.clientHeight,
              sheetFull: sheet.offsetHeight >= parseFloat(getComputedStyle(sheet).maxHeight) - 1,
              taller: element.offsetHeight > normal
            }
          }, normalHeight)
        )
        .toEqual({ setsScroll: false, sheetFull: true, taller: true })

    // A long press grows or shrinks it while the finger is still down, and the release logs nothing.
    const hold = async (grown: boolean, button = finishBtn) => {
      // Once cards have opened or closed, so the button stays where it was measured, and in the middle of the screen,
      // clear of the bottom nav, which page.mouse would press instead.
      await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
      await button.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const box = (await button.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      const list = page.locator('#exercises-list')
      if (grown) await expect(list).toHaveClass(/finish-set-grown/)
      else await expect(list).not.toHaveClass(/finish-set-grown/)
      await page.mouse.up()
      // Measured once the finger is up, since a pressed button shrinks a little.
      const height = async () => (await button.boundingBox())!.height
      if (grown) await grownInRoom(button)
      else await expect.poll(height).toBeLessThan(100)
    }
    await hold(true)
    // Grown, it sits on screen whole.
    await expect
      .poll(async () => {
        const box = (await finishBtn.boundingBox())!
        return box.y >= 0 && box.y + box.height <= viewport.height
      })
      .toBe(true)
    // WebKit reports only the prefixed property.
    expect(
      await finishBtn.evaluate((button) => {
        const style = getComputedStyle(button)
        return style.userSelect || style.getPropertyValue('-webkit-user-select')
      })
    ).toBe('none')
    await expect(logged).toHaveCount(0)

    // A tap anywhere else leaves it grown.
    await card.locator('.exercise-sheet-title').click()
    await grownInRoom()

    // A tap on it logs the set, and it stays grown for the next one.
    await finishBtn.click()
    await expect(logged).toHaveCount(1)
    await expect(breakTimer).toBeVisible()
    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await expect(breakTimer).toBeHidden()
    await grownInRoom()

    // Once the exercise is done, its sheet has no next set to grow into, so it fits its sets again.
    for (const done of [2, 3]) {
      await finishBtn.click()
      await expect(logged).toHaveCount(done)
      await breakTimer.getByRole('button', { name: 'Skip' }).click()
      await expect(breakTimer).toBeHidden()
    }
    await finishBtn.click()
    await expect(logged).toHaveCount(4)
    // The set that finishes the exercise closes its sheet.
    const sheet = card.locator('.exercise-sheet')
    await expect(sheet).toHaveJSProperty('open', false)
    await card.locator('.exercise-open-btn').click()
    await expect(sheet).toHaveJSProperty('open', true)
    await expect(finishBtn).toBeHidden()
    await expect
      .poll(() =>
        sheet.evaluate(
          (dialog: HTMLElement) => dialog.offsetHeight < parseFloat(getComputedStyle(dialog).maxHeight) - 1
        )
      )
      .toBe(true)

    // Another card opens with its button grown too.
    await card.getByRole('button', { name: 'Close dialog' }).click()
    const nextCard = cards.nth(1)
    await nextCard.locator('.exercise-open-btn').click()
    const nextBtn = nextCard.locator('.next-set-form').getByRole('button', { name: 'Finished set' })
    await grownInRoom(nextBtn)

    // Only another hold shrinks it back, and logs nothing.
    await hold(false, nextBtn)
    await expect(nextCard.locator('.completed-sets .set.isCompleted')).toHaveCount(0)
  })

  test('pulling the break timer down minimizes it, a short pull slides back, and the strip expands it', async ({
    page
  }) => {
    const card = page.locator('#exercises-list > .card').first()
    const form = card.locator('.next-set-form')
    await card.locator('.exercise-open-btn').click()
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')
    await form.getByRole('button', { name: 'Finished set' }).click()
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)

    // While the timer morphs between its two looks, the page under the transition takes the pointer.
    const settled = () => expect(page.locator('html')).not.toHaveClass(/morphing-break-timer/)
    const pull = async (distance: number) => {
      await settled()
      const box = (await breakTimer.locator('#countdown').boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + distance, { steps: 10 })
      await page.mouse.up()
    }

    // A short pull is let go before the timer minimizes, and the release taps nothing.
    await pull(30)
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    await expect(breakTimer).toHaveCSS('translate', 'none')

    await pull(200)
    await expect(breakTimer).toHaveClass(/dialog-minimized/)
    await expect(breakTimer).toHaveCSS('translate', 'none')

    // The release that minimized it doesn't count as a tap on the strip, which would open it again.
    await expect(breakTimer).not.toHaveClass(/dialog-full-screen/)

    // The strip's Expand button opens the full timer, which hides it again.
    const expand = breakTimer.getByRole('button', { name: 'Expand' })
    await expect(expand).toBeVisible()
    await settled()
    await expand.click()
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    await expect(expand).toBeHidden()

    // A tap anywhere else on the strip still opens it too.
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)
    await settled()
    await breakTimer.click()
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
  })

  test('the minimized break timer is a strip across the top that holds its countdown and moves nothing on screen', async ({
    page
  }) => {
    const card = page.locator('#exercises-list > .card').first()
    const form = card.locator('.next-set-form')
    await card.locator('.exercise-open-btn').click()
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')
    await form.getByRole('button', { name: 'Finished set' }).click()
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    // A card further down, where the page is scrolled to under the full timer.
    const lastCard = page.locator('#exercises-list > .card').last()
    await page.evaluate(() => window.scrollTo(0, 80))
    const before = (await lastCard.boundingBox())!.y
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)

    // The strip runs along the top edge with the countdown inside it.
    const strip = (await breakTimer.boundingBox())!
    const countdown = (await breakTimer.locator('#countdown').boundingBox())!
    expect(strip.y).toBeLessThanOrEqual(1)
    expect(countdown.y).toBeGreaterThanOrEqual(strip.y)
    expect(countdown.y + countdown.height).toBeLessThanOrEqual(strip.y + strip.height)
    // It reads "Rest 2:29 · Bench press set 2 next", over a line that shrinks as the break runs out.
    await expect(breakTimer.getByText('Rest', { exact: true })).toBeVisible()
    await expect(breakTimer.locator('#break-strip-next')).toHaveText('· Bench press set 2 next')
    await expect
      .poll(() => breakTimer.evaluate((dialog) => Number(dialog.style.getPropertyValue('--break-left'))))
      .toBeLessThan(1)
    // The page scrolled by the strip's height, so what was on screen stayed where it was.
    await expect.poll(async () => Math.abs((await lastCard.boundingBox())!.y - before)).toBeLessThanOrEqual(1)

    // The page starts under the strip, so scrolled to the top its header shows whole.
    await card.getByRole('button', { name: 'Close dialog' }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect
      .poll(async () => (await page.locator('.app-header').boundingBox())!.y)
      .toBeGreaterThanOrEqual(strip.y + strip.height - 1)

    // Gone, it takes its room with it, and again nothing moves on screen.
    await page.evaluate(() => window.scrollTo(0, 200))
    const scrolled = (await lastCard.boundingBox())!.y
    await breakTimer.click()
    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await expect(breakTimer).toBeHidden()
    await expect.poll(async () => Math.abs((await lastCard.boundingBox())!.y - scrolled)).toBeLessThanOrEqual(1)
  })

  test('set rows spread their fields across the row, in columns', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const form = card.locator('.next-set-form')
    await card.locator('.exercise-open-btn').click()
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')
    await form.getByRole('button', { name: 'Finished set' }).click()
    await expect(card.locator('.completed-sets > .isCompleted')).toHaveCount(1)

    // Each row's last field ends at the row's right edge, inside its padding, and every column starts at the same x.
    const rows = await card.locator('.completed-sets > .set').evaluateAll((sets) =>
      sets.map((set) => {
        const row = set.getBoundingClientRect()
        const fields = [...set.querySelectorAll('.set-fields > *')].map((field) => field.getBoundingClientRect())
        return {
          rightGap: Math.round(row.right - fields.at(-1)!.right),
          starts: fields.map(({ left }) => Math.round(left))
        }
      })
    )
    expect(rows.length).toBeGreaterThan(1)
    for (const { rightGap, starts } of rows) {
      expect(rightGap).toBeLessThanOrEqual(16)
      expect(starts).toEqual(rows[0].starts)
    }
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
    const firstExercise = page.locator('#exercises-list > .card').first()
    await firstExercise.locator('.exercise-open-btn').click()
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

  test('the set that finishes an exercise closes its sheet, and the card shows it done', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const sheet = card.locator('.exercise-sheet')
    const form = card.locator('.next-set-form')
    const pending = card.locator('.completed-sets .set.isPending')
    const breakTimer = page.locator('#break-countdown-dialog')
    const logSet = async () => {
      await form.locator('input[name="set-reps"]').fill('10')
      await form.locator('input[name="set-weight"]').fill('100')
      await form.getByRole('button', { name: 'Finished set' }).click()
    }

    await card.locator('.exercise-open-btn').click()
    await expect(form).toBeVisible()
    const total = await pending.count()
    for (let left = total; left > 1; left--) {
      await logSet()
      await expect(pending).toHaveCount(left - 1)
      await breakTimer.getByRole('button', { name: 'Skip' }).click()
      await expect(breakTimer).toBeHidden()
      // The sheet stays open between sets, for the next one.
      await expect(sheet).toHaveJSProperty('open', true)
    }
    await expect(card.locator('.exercise-progress-count')).toHaveText(`${total - 1}/${total}`)
    await expect(page.locator('.workout-progress-bar')).toHaveJSProperty('value', total - 1)

    await logSet()
    await expect(sheet).toHaveJSProperty('open', false)
    await expect(card).toHaveClass(/card-success/)
    await expect(card.locator('.next-set')).toHaveClass(/hidden/)
    await expect(card.locator('.exercise-progress-count')).toHaveText(`${total}/${total}`)
    await expect(card.locator('.exercise-progress i.isLogged')).toHaveCount(total)
    await expect(card.locator('.exercise-next')).toBeHidden()
    await expect(page.locator('.workout-exercises-done')).toHaveText('1')
  })

  test('the cards and the progress bar show the plan before the workout starts', async ({ page }) => {
    const cards = page.locator('#exercises-list > .card')
    const card = cards.first()
    await expect(card.locator('.exercise-progress-count')).toHaveText(/^0\/\d+$/)
    await expect(card.locator('.exercise-next')).toContainText('Next')
    await expect(page.locator('.workout-exercises-done')).toHaveText('0')
    await expect(page.locator('.workout-exercises-total')).toHaveText(String(await cards.count()))
    await expect(page.locator('.workout-sets-done')).toHaveText('0')
    await expect(card.locator('.exercise-open-btn')).toHaveAccessibleName(/^.+: 0 of \d+ sets, next .+$/)
  })

  test('the sheet stays open under the minimized break timer, whose strip stays on screen and takes taps', async ({
    page
  }) => {
    const card = page.locator('#exercises-list > .card').first()
    const form = card.locator('.next-set-form')
    await card.locator('.exercise-open-btn').click()
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('100')
    await form.getByRole('button', { name: 'Finished set' }).click()
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    await expect(card.locator('.exercise-sheet')).toHaveJSProperty('open', true)

    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)
    const sheet = card.locator('.exercise-sheet')
    await expect(sheet).toHaveJSProperty('open', true)

    // The sheet starts under the strip, so the strip shows whole and its Expand button is what a tap there reaches.
    const strip = (await breakTimer.boundingBox())!
    const sheetBox = (await sheet.boundingBox())!
    expect(sheetBox.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1)
    await expect(form.getByRole('button', { name: 'Finished set' })).toBeInViewport()
    await breakTimer.getByRole('button', { name: 'Expand' }).click()
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)
    await breakTimer.getByRole('button', { name: 'Skip' }).click()
    await expect(breakTimer).toBeHidden()
    await expect(sheet).toHaveJSProperty('open', true)

    // A tap on the page around the sheet closes it.
    await page.locator('.app-header-title').click()
    await expect(sheet).toHaveJSProperty('open', false)

    // Esc closes it too, and the focus goes back to the card.
    await card.locator('.exercise-open-btn').click()
    await expect(sheet).toHaveJSProperty('open', true)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveJSProperty('open', false)
    await expect(card.locator('.exercise-open-btn')).toBeFocused()
  })

  test('opening a program saves nothing until the first change starts the workout', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const rows = card.locator('.completed-sets > .set')
    await expect(page.locator('#workout-date-label')).toHaveText('Today')
    await card.locator('.exercise-open-btn').click()
    const planned = await rows.count()
    await expect(page.locator('#delete-workout-session-btn')).toBeHidden()
    // The workouts page, open beside it, lists a started workout as incomplete.
    const workouts = await page.context().newPage()
    await workouts.goto('/workouts/')
    await expect(workouts.locator('.calendar-week').first()).toBeVisible()
    await expect(workouts.locator('.calendar-workout[data-status="incomplete"]')).toHaveCount(0)

    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(rows).toHaveCount(planned + 1)
    await expect(page.locator('#delete-workout-session-btn')).toBeVisible()
    await workouts.reload()
    await expect(workouts.locator('.calendar-workout[data-status="incomplete"]')).toHaveCount(1)

    // After the start, the details save as they change.
    await card.getByRole('button', { name: 'Close dialog' }).click()
    await page.locator('#workout-details > summary').click()
    await page.locator('textarea[name="notes"]').fill('Felt strong')
    await page.locator('textarea[name="notes"]').blur()
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')
    await page.reload()
    await expect(page.locator('textarea[name="notes"]')).toHaveValue('Felt strong')
  })

  test('two changes made at once both reach the workout', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const rows = card.locator('.completed-sets > .set')
    await card.locator('.exercise-open-btn').click()
    const planned = await rows.count()

    // Two taps on Add set land before the first one's write does: the first starts the workout and the second waits
    // for it, then both slots are stored, each on the session the change before stored.
    await card.locator('.add-set-btn').evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(rows).toHaveCount(planned + 2)
    await card.locator('.add-set-btn').evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(rows).toHaveCount(planned + 4)
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')

    await page.reload()
    await card.locator('.exercise-open-btn').click()
    await expect(rows).toHaveCount(planned + 4)
  })

  test('a change that fails to save says so and can be made again', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const rows = card.locator('.completed-sets > .set')
    await card.locator('.exercise-open-btn').click()
    const stored = (await rows.count()) + 1
    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(rows).toHaveCount(stored)
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')
    // A fresh document, so no "Workout started" toast is queued ahead of the one the failure shows.
    await page.reload()
    await card.locator('.exercise-open-btn').click()
    await expect(rows).toHaveCount(stored)

    // The next write fails, as one does when the database went away under the page.
    await page.evaluate(async () => {
      const { storage } = await import('/src/db/storage.ts')
      const writeRows = storage.writeRows.bind(storage)
      storage.writeRows = async () => {
        storage.writeRows = writeRows
        throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
      }
    })
    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Could not save that change')
    await expect(page.locator('#exercises-list')).not.toHaveAttribute('aria-busy')
    await expect(rows).toHaveCount(stored)

    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(rows).toHaveCount(stored + 1)
    await page.reload()
    await card.locator('.exercise-open-btn').click()
    await expect(rows).toHaveCount(stored + 1)
  })

  test('deleting the workout ends its break', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    await card.locator('.exercise-open-btn').click()
    const setForm = card.locator('.next-set-form').first()
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')
    await setForm.getByRole('button', { name: 'Finished set' }).first().click()
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    await expect(breakTimer).toHaveClass(/dialog-minimized/)
    // The exercise's sheet stays open under the bar, so it is closed first.
    await card.getByRole('button', { name: 'Close dialog' }).click()

    page.once('dialog', (dialog) => void dialog.accept())
    await page.locator('#delete-workout-session-btn').click()
    // Without the Navigation API, as in the WebKit projects, the workouts page loads in full, so the toast and the old
    // break go with the old document. With it, the router keeps the document, and the break has to end itself.
    await expect(page).toHaveURL(/\/workouts\/$/)
    await expect(breakTimer).toBeHidden()
  })

  test('removes a set to do from its menu, and a logged set from Edit set', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const pending = card.locator('.completed-sets .set.isPending')
    const logged = card.locator('.completed-sets .set.isCompleted')
    await card.locator('.exercise-open-btn').click()
    const total = await pending.count()

    await card.locator('input[name="set-reps"]').fill('10')
    await card.locator('input[name="set-weight"]').fill('100')
    await card.getByRole('button', { name: 'Finished set' }).click()
    await page.locator('#break-countdown-dialog').getByRole('button', { name: 'Skip' }).click()
    await expect(logged).toHaveCount(1)

    // Removing a set to do asks first, and No keeps it.
    await card.getByRole('button', { name: `Set ${total}, to do` }).click()
    page.once('dialog', (dialog) => void dialog.dismiss())
    await page.getByRole('button', { name: `Remove set ${total}` }).click()
    await expect(page.locator('.set-menu:popover-open')).toHaveCount(0)
    await expect(pending).toHaveCount(total - 1)

    page.on('dialog', (dialog) => void dialog.accept())
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

    await logged.first().click()
    await page.locator('#edit-set-dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Set deleted')
    await expect(logged).toHaveCount(0)
    await expect(pending).toHaveCount(1)
    await expect(card.getByRole('button', { name: 'Set 1, to do' })).toHaveCount(0)
  })

  test('a tap outside an open set menu only closes it', async ({ page }) => {
    const card = page.locator('#exercises-list > .card').first()
    const rows = card.getByRole('button', { name: /, to do$/ })
    const menu = page.locator('.set-menu:popover-open')
    await card.locator('.exercise-open-btn').click()

    await rows.first().click()
    await expect(menu).toBeVisible()
    await expect(rows.first()).toHaveClass(/isSelected/)

    // The last row's tap closes the menu and does nothing else. The menu may cover the row under the first.
    await rows.last().click()
    await expect(menu).toHaveCount(0)
    await expect(card.locator('.set.isSelected')).toHaveCount(0)

    await rows.last().click()
    await expect(menu).toBeVisible()
    await expect(card.locator('.set.isSelected')).toHaveCount(1)
    await expect(rows.last()).toHaveClass(/isSelected/)

    // So does a tap on the sheet's close button, which leaves the sheet open.
    await card.getByRole('button', { name: 'Close dialog' }).click()
    await expect(menu).toHaveCount(0)
    await expect(card.locator('.exercise-sheet')).toHaveJSProperty('open', true)
  })

  test('prefills location from the latest saved workout when starting a new session', async ({ page }) => {
    await page.locator('#workout-details > summary').click()
    await page.locator('input[name="location"]').fill('Memorial Gym')
    await startWorkout(page)

    await page.locator('#back-button').click()
    await expect(page).toHaveURL(/\/workouts\//)

    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await dialog.locator('a.program-pick').nth(1).click()
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
    await page.locator('dialog#new-workout-dialog a.program-pick').first().click()

    // The page wires Add exercise before it draws the cards, so a tap before the first card shows does nothing.
    await expect(page.locator('#exercises-list > .card').first()).toBeVisible()
    // Adding the exercise starts the workout.
    await page.locator('#add-exercise-btn').click()
    const picker = page.locator('#exercise-picker')
    await picker.getByLabel(exerciseName).check()
    await picker.getByRole('button', { name: 'Add 1 exercise' }).click()
    await expect(picker).not.toBeVisible()

    const card = page.locator('#exercises-list .card', { hasText: exerciseName }).first()
    await expect(card).toBeVisible()
    await card.locator('.exercise-open-btn').click()
    return card
  }

  test('logs a treadmill set in minutes, speed and incline', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Treadmill walk')
    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Cardio' }).check()
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
    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Rehab' }).check()
    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Hold' }).check()
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
