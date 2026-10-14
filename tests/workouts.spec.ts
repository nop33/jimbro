import { test, expect } from '@playwright/test'
import { seedDatabase } from './seed'
import { startWorkout } from './startWorkout'

test.describe('Workouts Page', () => {
  test.beforeEach(async ({ page }) => {
    // Each test's browser context starts with an empty database.
    await page.goto('/workouts/')
  })

  test('Greets a new user with the onboarding intro, and seeds the sample programs', async ({ page }) => {
    const seedBtn = page.getByRole('button', { name: 'Seed Database' })
    await expect(seedBtn).toBeVisible()
    // A returning user on a new phone signs in with their passkey instead. Every project's browser has passkeys.
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toHaveCount(1)
    await expect(page.locator('#intro')).toHaveText(
      "Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?"
    )

    await seedBtn.click()

    // The page reloads into the workout calendar.
    await expect(page.locator('.workout-week')).toBeVisible()
    await expect(seedBtn).not.toBeVisible()
  })

  test('Offers the cloud backup to a signed-in user with an empty database', async ({ page }) => {
    await page.route('**/api/**', (route) => route.abort())
    await page.addInitScript(() => {
      localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'someone', token: 'secret' }))
    })

    await page.goto('/workouts/')
    await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Seed Database' })).toHaveCount(0)
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
    const reloaded = page.waitForEvent('framenavigated')
    await restoreButton.click()
    releasePull()
    await reloaded

    await expect(page.getByRole('button', { name: 'Seed Database' })).toBeVisible()
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
    const programCards = page.locator('#programs-grid > .card')
    await expect(programCards.first()).toBeVisible()
    page.on('dialog', (dialog) => dialog.accept())
    for (let remaining = await programCards.count(); remaining > 0; remaining--) {
      await programCards.first().locator('.edit-program-btn').click()
      await page.locator('#delete-program-btn').click()
      await expect(page.locator('#program-dialog')).toBeHidden()
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
    await page.locator('#delete-exercise-btn').click()
    await expect(page.locator('#exercise-dialog')).toBeHidden()

    await page.goto('/workouts/')
    await expect(page.getByRole('button', { name: 'Seed Database' })).toHaveCount(0)
    await expect(page.locator('#intro')).toHaveText("Let's start by defining your exercises and programs!")
  })

  test('Shows correct weekly view and start new workout dialog', async ({ page }) => {
    await seedDatabase(page)

    // Check new workout dialog
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()
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
    // Choosing a mode reloads the page at once, so a click stands in for check(), which would look for the checked state after it.
    await modeDialog.getByRole('radio', { name: 'Freestyle' }).click()

    // The page reloads in freestyle, where this week shows an empty slot for each workout toward the goal.
    await expect(page.locator('#workout-mode-name')).toHaveText('Freestyle')
    await expect(page.locator('#workout-mode-rule')).toHaveText('Goal 3')
    await expect(page.locator('#week-progress-count')).toHaveText('0 of 3 workouts done')
    const openSlots = page.locator('.workout-week').first().getByRole('button', { name: 'Start a workout' })
    await expect(openSlots).toHaveCount(3)

    await openSlots.first().click()
    await expect(page.locator('dialog#new-workout-dialog')).toBeVisible()
  })

  test('Updates status correctly when navigating back from an incomplete workout', async ({ page }) => {
    await seedDatabase(page)

    // Check initial status, there should be pending workouts
    const pendingWorkouts = page.locator('.card-pending')
    await expect(pendingWorkouts.first()).toBeVisible()

    // Store original number of pending workouts
    const originalPendingCount = await pendingWorkouts.count()

    // Start a new workout by clicking a pending one
    await pendingWorkouts.first().click()

    // It should navigate to /gymtime/ with programId
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)

    await startWorkout(page)

    // Navigate back to the workouts page
    await page.goBack()

    // Wait for workouts page to be visible again
    await expect(page.locator('.workout-week')).toBeVisible()

    // The previously pending workout should now be incomplete (card-warning)
    // So pending workouts should be exactly 1 less
    await expect(pendingWorkouts).toHaveCount(originalPendingCount - 1)

    // There should be an incomplete workout
    await expect(page.locator('.workout-week .card-warning')).toHaveCount(1)
  })
})
