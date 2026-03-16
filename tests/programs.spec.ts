import { test, expect } from '@playwright/test'

test.describe('Programs Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    // Create a mock exercise to add to our program
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Squat')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Quads' })
    await page.getByLabel('Default sets').fill('4')
    await page.getByLabel('Default reps').fill('8')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.card', { hasText: 'Squat' })).toBeVisible()

    // Give it a moment to ensure database write is done completely
    await page.waitForTimeout(500)

    // Go to programs
    await page.goto('/programs/')
  })

  test('create, edit, and delete a program', async ({ page }) => {
    // 1. Create
    await page.getByRole('button', { name: 'New' }).click()

    const dialog = page.locator('dialog#program-dialog')
    await expect(dialog).toBeVisible()

    // Verify "X" button works
    await dialog.locator('.close-dialog-btn').click()
    await expect(dialog).not.toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name', { exact: true }).fill('Leg Day')

    // Add exercise to program
    // Playwright has trouble selecting options inside optgroups sometimes, use the option label
    await page.locator('#exercises-selection').selectOption({ label: 'Squat' })

    await page.getByRole('button', { name: 'Save' }).click()

    // Verify
    const programCard = page.locator('.card', { hasText: 'Leg Day' })
    await expect(programCard).toBeVisible()
    await expect(programCard).toContainText('Squat')

    // 2. Edit
    // Click the edit button on the program card
    await programCard.locator('button.link-primary').first().click()
    await expect(dialog).toBeVisible()

    await page.getByLabel('Name', { exact: true }).fill('Mega Leg Day')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(programCard).toContainText('Mega Leg Day')

    // 3. Delete
    await programCard.locator('button.link-primary').first().click()
    await expect(dialog).toBeVisible()

    page.once('dialog', async (confirmDialog) => {
      await confirmDialog.accept()
    })

    await page.locator('#delete-program-btn').click()
    await expect(programCard).not.toBeVisible()
  })
})
