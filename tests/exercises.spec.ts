import { test, expect } from '@playwright/test'

test.describe('Exercises Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    // Go to exercises
    await page.goto('/exercises/')
  })

  test('create, edit, and delete an exercise', async ({ page }) => {
    // 1. Create
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#exercise-dialog')
    await expect(dialog).toBeVisible()

    // Verify "X" button works
    await dialog.locator('.close-dialog-btn').click()
    await expect(dialog).not.toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name').fill('Bench Press')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default reps').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()

    // Verify
    const exerciseCard = page.locator('.card', { hasText: 'Bench Press' })
    await expect(exerciseCard).toBeVisible()
    await expect(exerciseCard).toContainText('Chest')
    await expect(exerciseCard).toContainText('3 sets × 10 reps')

    // 2. Edit
    await exerciseCard.click()
    await expect(dialog).toBeVisible()

    await page.getByLabel('Default reps').fill('8')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(exerciseCard).toContainText('3 sets × 8 reps')

    // 3. Filter
    const filter = page.getByLabel('Filter by muscle group')
    await filter.selectOption({ label: 'Back' })
    await expect(exerciseCard).not.toBeVisible()

    await filter.selectOption({ label: 'Chest' })
    await expect(exerciseCard).toBeVisible()

    // 4. Delete
    await exerciseCard.click()
    await expect(dialog).toBeVisible()

    page.once('dialog', async (confirmDialog) => {
      await confirmDialog.accept()
    })

    await page.locator('#delete-exercise-btn').click()
    await expect(exerciseCard).not.toBeVisible()
  })
})
