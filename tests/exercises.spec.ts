import { test, expect } from '@playwright/test'

test.describe('Exercises Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
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
    await expect(page.getByLabel('Kind')).toHaveValue('lifting')
    await expect(page.locator('#exercise-preset-field')).toBeHidden()
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

  test('create a cardio exercise logged in minutes, speed and incline', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#exercise-dialog')
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name').fill('Treadmill walk')
    await page.getByLabel('Kind').selectOption('cardio')

    await expect(page.locator('#exercise-preset-field')).toBeHidden()
    await expect(page.locator('#exercise-muscle-field')).toBeHidden()

    await page.getByLabel('Default sets').fill('1')
    await expect(page.getByLabel('Default time (min)')).toHaveCount(0)
    await expect(page.getByLabel('Default speed (km/h)')).toHaveCount(0)
    await expect(page.getByLabel('Default incline (%)')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save' }).click()

    const exerciseCard = page.locator('.card', { hasText: 'Treadmill walk' })
    await expect(exerciseCard).toBeVisible()
    await expect(exerciseCard).toContainText('Cardio')
    await expect(exerciseCard).toContainText('1 set')
    await expect(exerciseCard).not.toContainText('min')

    await exerciseCard.click()
    await expect(dialog).toBeVisible()
    await expect(page.getByLabel('Default sets')).toHaveValue('1')
    await expect(page.getByLabel('Default time (min)')).toHaveCount(0)
  })

  test('create a rehab exercise logged as a hold', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#exercise-dialog')
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name').fill('Side plank')
    await page.getByLabel('Kind').selectOption('rehab')

    await expect(page.locator('#exercise-preset-field')).toBeVisible()
    await expect(page.getByLabel('Default reps')).toBeVisible()

    await page.getByLabel('Log as').selectOption({ label: 'Hold' })
    await expect(page.getByLabel('Default reps')).toHaveCount(0)

    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Core' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default hold (sec)').fill('30')
    await page.getByRole('button', { name: 'Save' }).click()

    const exerciseCard = page.locator('.card', { hasText: 'Side plank' })
    await expect(exerciseCard).toBeVisible()
    await expect(exerciseCard).toContainText('Core')
    await expect(exerciseCard).toContainText('Rehab')
    await expect(exerciseCard).toContainText('3 sets × 30s hold')
  })
})
