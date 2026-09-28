import { test, expect } from '@playwright/test'

test.describe('Workouts Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    // Go to workouts
    await page.goto('/workouts/')
  })

  test('Greets a new user with the onboarding intro', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Seed Database' })).toBeVisible()
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
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()

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

  test('Seed Database functionality works', async ({ page }) => {
    // We should see the seed database button when the DB is empty
    const seedBtn = page.getByRole('button', { name: 'Seed Database' })
    await expect(seedBtn).toBeVisible()

    await seedBtn.click()

    // The page should reload and we should see a workout calendar layout
    await expect(page.locator('.workout-week')).toBeVisible()
    await expect(seedBtn).not.toBeVisible()
  })

  test('Shows correct weekly view and start new workout dialog', async ({ page }) => {
    // Seed db
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()

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

    // Click on a program option
    await firstProgramLink.click()

    // It should navigate to /gymtime/ with programId
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test('Updates status correctly when navigating back from an incomplete workout', async ({ page }) => {
    // Seed db
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()

    // Check initial status, there should be pending workouts
    const pendingWorkouts = page.locator('.card-pending')
    await expect(pendingWorkouts.first()).toBeVisible()

    // Store original number of pending workouts
    const originalPendingCount = await pendingWorkouts.count()

    // Start a new workout by clicking a pending one
    await pendingWorkouts.first().click()

    // It should navigate to /gymtime/ with programId
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)

    // Start workout session
    await page.getByRole('button', { name: 'Save & start workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved.')

    // Navigate back to the workouts page
    await page.goBack()

    // Wait for workouts page to be visible again
    await expect(page.locator('.workout-week')).toBeVisible()

    // The previously pending workout should now be incomplete (card-warning)
    // So pending workouts should be exactly 1 less
    const newPendingCount = await pendingWorkouts.count()
    expect(newPendingCount).toBe(originalPendingCount - 1)

    // There should be an incomplete workout
    await expect(page.locator('.card-warning').first()).toBeVisible()
  })
})
