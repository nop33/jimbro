import { expect } from '@playwright/test'
import { test } from './fixtures'

test.describe('Exercises Page', () => {
  test.beforeEach(async ({ page }) => {
    // Each test's browser context starts with an empty database.
    await page.goto('/exercises/')
  })

  test('create, edit, and delete an exercise', async ({ page }) => {
    // 1. Create
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#exercise-dialog')
    await expect(dialog).toBeVisible()

    // Verify "X" button works
    await dialog.getByRole('button', { name: 'Close dialog' }).click()
    await expect(dialog).not.toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    await expect(dialog).toBeVisible()
    // An empty form opens on its first field, ready to type.
    await expect(page.getByLabel('Name')).toBeFocused()
    // A new item has nothing to delete, and the ✕ is the only way to cancel.
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

    await page.getByLabel('Name').fill('Bench Press')
    await expect(page.locator('#exercise-dialog').getByRole('radio', { name: 'Lifting' })).toBeChecked()
    await expect(page.locator('#exercise-preset-field')).toBeHidden()
    // A new exercise starts at 4 sets of 8 reps.
    await expect(page.getByLabel('Default sets')).toHaveValue('4')
    await expect(page.getByLabel('Default reps')).toHaveValue('8')
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
    // A filled form opens on its title, with no field focused, so no keyboard covers it.
    await expect(dialog.getByRole('heading', { name: 'Edit Exercise' })).toBeFocused()

    await page.getByLabel('Default reps').fill('8')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(exerciseCard).toContainText('3 sets × 8 reps')

    // − and + step the numbers, and − can't go under one.
    await exerciseCard.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Sets up' }).click()
    await expect(page.getByLabel('Default sets')).toHaveValue('4')
    await dialog.getByRole('button', { name: 'Reps down' }).click()
    await expect(page.getByLabel('Default reps')).toHaveValue('7')
    for (const value of ['3', '2', '1']) {
      await dialog.getByRole('button', { name: 'Sets down' }).click()
      await expect(page.getByLabel('Default sets')).toHaveValue(value)
    }
    await expect(dialog.getByRole('button', { name: 'Sets down' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Sets up' }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(exerciseCard).toContainText('2 sets × 7 reps')

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

    await page.locator('#exercise-dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(exerciseCard).not.toBeVisible()
  })

  test('create a cardio exercise logged in minutes, speed and incline', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#exercise-dialog')
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name').fill('Treadmill walk')
    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Cardio' }).check()

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
    // A treadmill exercise has no default time, so the prescription is the sets alone.
    await expect(exerciseCard.locator('.exercise-prescription')).toHaveText('1 set')

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
    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Rehab' }).check()

    await expect(page.locator('#exercise-preset-field')).toBeVisible()
    await expect(page.getByLabel('Default reps')).toBeVisible()

    await page.locator('#exercise-dialog').getByRole('radio', { name: 'Hold' }).check()
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
