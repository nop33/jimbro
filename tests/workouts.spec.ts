import { test, expect } from '@playwright/test'

test.describe('Workouts Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    // Go to workouts
    await page.goto('/workouts/')
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

    // Verify dialog has program options
    // The seed data created some programs
    const firstProgramLink = dialog.locator('a.program-link').first()
    await expect(firstProgramLink).toBeVisible()

    // Click on a program option
    await firstProgramLink.click()

    // It should navigate to /gymtime/ with programId
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })
})
