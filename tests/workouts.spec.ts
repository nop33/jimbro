import { expect } from '@playwright/test'
import { test } from './fixtures'
import { logWorkout } from './logWorkout'
import { seedDatabase } from './seed'
import { startWorkout } from './startWorkout'
import { browserHasPasskeys } from './browserPasskeys'

test.describe('Workouts Page', () => {
  test.beforeEach(async ({ page }) => {
    // Each test's browser context starts with an empty database.
    await page.goto('/workouts/')
  })

  test('Greets a new user with the onboarding intro, and seeds the sample programs', async ({ page }) => {
    const seedBtn = page.getByRole('button', { name: 'Start with the 3-day split' })
    await expect(seedBtn).toBeVisible()
    // A returning user on a new phone signs in with their passkey instead, where the browser has passkeys.
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toHaveCount(
      (await browserHasPasskeys(page)) ? 1 : 0
    )
    await expect(page.locator('#intro')).toHaveText(
      "Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?"
    )

    await seedBtn.click()

    // The page reloads into the workout calendar.
    await expect(page.locator('.calendar-week').first()).toBeVisible()
    await expect(seedBtn).not.toBeVisible()
  })

  test('Offers the cloud backup to a signed-in user with an empty database', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort())
    await page.addInitScript(() => {
      localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'someone', token: 'secret' }))
    })

    await page.goto('/workouts/')
    await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start with the 3-day split' })).toHaveCount(0)
    await expect(page.locator('#intro')).toHaveText(
      'Your workouts are backed up in the cloud. Restore them to pick up where you left off.'
    )
  })

  test('Offers the seed once a restore finds nothing in the cloud', async ({ page }) => {
    let releasePull = () => {}
    const pullHeld = new Promise<void>((resolve) => {
      releasePull = resolve
    })
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname !== '/api/pull') return route.abort()
      await pullHeld
      await route.fulfill({ json: { rows: [], cursor: 0, more: false } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'someone', token: 'secret' }))
    })

    await page.goto('/workouts/')
    const restoreButton = page.getByRole('button', { name: 'Restore from cloud' })
    await expect(restoreButton).toBeVisible()
    await restoreButton.click()
    releasePull()

    await expect(page.getByRole('button', { name: 'Start with the 3-day split' })).toBeVisible()
    await expect(restoreButton).toHaveCount(0)
    await expect(page.locator('#intro')).toHaveText(
      "Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?"
    )
  })

  test('Asks a user with exercises but no program to create one', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Bench Press')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default reps').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Exercise saved!')

    await page.goto('/workouts/')
    await expect(page.locator('#intro')).toHaveText('Create a program from your exercises to start a workout.')
  })

  test('Asks for a program again once every program is deleted', async ({ page }) => {
    await seedDatabase(page)

    await page.goto('/programs/')
    const programCards = page.locator('#programs-grid .program-card')
    await expect(programCards.first()).toBeVisible()
    page.on('dialog', (dialog) => dialog.accept())
    for (let remaining = await programCards.count(); remaining > 0; remaining--) {
      await programCards.first().click()
      await page.getByRole('button', { name: 'Delete program' }).click()
      await expect(page).toHaveURL(/\/programs\/$/)
      await expect(programCards).toHaveCount(remaining - 1)
    }

    await page.goto('/workouts/')
    await expect(page.locator('#intro')).toHaveText('Create a program from your exercises to start a workout.')
  })

  test('Asks a user who deleted everything to start over', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Bench Press')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default reps').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Exercise saved!')

    await page.locator('.card', { hasText: 'Bench Press' }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('#exercise-dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('#exercise-dialog')).toBeHidden()

    await page.goto('/workouts/')
    await expect(page.getByRole('button', { name: 'Start with the 3-day split' })).toHaveCount(0)
    await expect(page.locator('#intro')).toHaveText("Let's start by defining your exercises and programs!")
  })

  test('Shows correct weekly view and start new workout dialog', async ({ page }) => {
    await seedDatabase(page)

    // Check new workout dialog
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()
    // The close button cancels, so the dialog has no Cancel.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
    await dialog.locator('.close-dialog-btn').click()
    await expect(dialog).not.toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    await expect(dialog).toBeVisible()

    const firstProgramLink = dialog.locator('a.program-link').first()
    await expect(firstProgramLink).toBeVisible()
    await expect(firstProgramLink.locator('.last-completed-date')).toHaveText('Not completed yet')

    // Click on a program option
    await firstProgramLink.click()

    // It should navigate to /gymtime/ with programId
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test("Shows this week's progress under the workout mode, and opens the mode dialog from it", async ({ page }) => {
    await seedDatabase(page)

    const progress = page.locator('#week-progress')
    await expect(page.locator('#workout-mode-name')).toHaveText('Rotation')
    await expect(page.locator('#week-progress-count')).toHaveText('0 of 3 programs done')
    await expect(page.locator('#week-progress-goal span')).toHaveCount(3)
    await expect(page.locator('#intro')).toBeHidden()

    await progress.click()
    const modeDialog = page.locator('dialog#workout-mode-dialog')
    await expect(modeDialog).toBeVisible()
    await expect(modeDialog.getByRole('heading', { name: 'Workout Mode' })).toBeFocused()
    // Choosing a mode draws the page again at once, so a click stands in for check(), which would look for the checked state after it.
    await modeDialog.getByRole('radio', { name: 'Freestyle' }).click()

    // The page draws again in freestyle, with the calendar's this week still to fill.
    await expect(page.locator('#workout-mode-name')).toHaveText('Freestyle')
    await expect(page.locator('#workout-mode-rule')).toHaveText('Goal 3')
    await expect(page.locator('#week-progress-count')).toHaveText('0 of 3 workouts done')
    await expect(page.locator('.calendar-week[data-state="current"]')).toHaveCount(1)
  })

  test('Marks a fourth workout for next week, and next week starts with it done ahead', async ({ page }) => {
    await seedDatabase(page)
    // Push, Pull and Legs in the week of 5 October, and Push again on Sunday the 11th.
    for (const [index, date] of [
      [0, '2026-10-05'],
      [1, '2026-10-06'],
      [2, '2026-10-07'],
      [0, '2026-10-11']
    ] as const) {
      await logWorkout(page, index, date, true)
    }

    await page.clock.setFixedTime(new Date(2026, 9, 11, 10, 0))
    await page.goto('/workouts/')
    await expect(page.locator('#week-progress-count')).toHaveText('3 of 3 programs done')
    await expect(page.locator('#week-progress-note')).toHaveText('All done this week, +1 workout toward next week! 💪')
    await expect(page.locator('#week-progress-goal .extra')).toHaveCount(1)
    // This week met its goal, and Sunday's Push carries a +1 for next week.
    const thisWeek = page.locator('.calendar-week').nth(-2)
    await expect(thisWeek).toHaveAttribute('data-state', 'met')
    await expect(thisWeek.locator('.calendar-workout')).toHaveCount(4)
    const sunday = thisWeek.locator('.calendar-day').last()
    await expect(sunday.locator('.calendar-extra')).toBeVisible()
    await expect(sunday.locator('.calendar-workout')).toHaveAttribute('aria-label', /counts toward next week/)
    await expect(page.locator('.calendar-week').last()).toHaveAttribute('data-state', 'next')

    // On Sunday the 18th, the busy week counts the Push done ahead, and is not met with one of its own.
    await page.clock.setFixedTime(new Date(2026, 9, 18, 10, 0))
    await logWorkout(page, 1, '2026-10-13', true)
    await page.goto('/workouts/')
    await expect(page.locator('#week-progress-count')).toHaveText('2 of 3 programs done')
    const busyWeek = page.locator('.calendar-week[data-state="current"]')
    await expect(busyWeek.locator('.calendar-ahead')).toHaveText('+1 ahead')
    await expect(busyWeek.locator('.calendar-workout')).toHaveCount(1)

    // A second workout in the busy week meets the goal with the one done ahead.
    await logWorkout(page, 2, '2026-10-15', true)
    await page.goto('/workouts/')
    const metWeek = page.locator('.calendar-week').nth(-2)
    await expect(metWeek).toHaveAttribute('data-state', 'met')
    await expect(metWeek.locator('.calendar-ahead')).toHaveText('+1 ahead')
  })

  test('Opens a workout from its day, and lists two workouts on one day in a popover', async ({ page }) => {
    await seedDatabase(page)
    const today = await page.evaluate(async () => (await import('/src/dateUtils.ts')).getSimpleDate(new Date()))
    const push = await logWorkout(page, 0, today, true)
    await page.goto('/workouts/')
    const day = page.locator('.calendar-day[aria-current="date"]')
    await expect(day.locator('.calendar-name')).toHaveText('Push')
    await expect(day.locator('a.calendar-workout')).toHaveAttribute('data-status', 'completed')
    await expect(day.locator('a.calendar-workout')).toHaveAttribute('href', `/gymtime/?id=${push.sessionId}`)

    const pull = await logWorkout(page, 1, today, false)
    await page.goto('/workouts/')
    const opener = day.locator('button.calendar-workout')
    await expect(day.locator('.calendar-count')).toHaveText('2')
    await opener.click()
    const popover = day.locator('.calendar-popover')
    await expect(popover).toBeVisible()
    await expect(popover.locator('a.calendar-popover-link')).toHaveCount(2)
    await expect(popover.getByRole('link', { name: /Push day/ })).toContainText('Done')
    await expect(popover.getByRole('link', { name: /Pull day/ })).toContainText('Started')
    await popover.getByRole('link', { name: /Pull day/ }).click()
    await expect(page).toHaveURL(new RegExp(`/gymtime/\\?id=${pull.sessionId}`))
  })

  test('Updates status correctly when navigating back from an incomplete workout', async ({ page }) => {
    await seedDatabase(page)
    await expect(page.locator('.calendar-workout')).toHaveCount(0)

    // Start a new workout from the program picker.
    await page.locator('#new-workout-btn').click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)

    await startWorkout(page)

    // Navigate back to the workouts page
    await page.goBack()

    // Today shows the workout, started but not finished.
    await expect(page.locator('.calendar-day[aria-current="date"] .calendar-workout')).toHaveAttribute(
      'data-status',
      'incomplete'
    )
  })
})
