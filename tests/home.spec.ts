import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
  test('displays correct header and welcome text', async ({ page }) => {
    await page.goto('/')

    // Check title
    await expect(page).toHaveTitle(/Jimbro/)

    // Check main header
    await expect(page.locator('h1')).toContainText('Hey, gymbro.')

    // Check Start workout link
    const startLink = page.getByRole('link', { name: 'Start workout' })
    await expect(startLink).toBeVisible()

    // Check Settings link
    const settingsLink = page.getByRole('link', { name: 'Settings', exact: true })
    await expect(settingsLink).toBeVisible()
  })

  test('navigates to workouts page when "Start workout" is clicked', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Start workout' }).click()

    // We expect the URL to change to /workouts/
    await expect(page).toHaveURL(/.*\/workouts\//)
  })
})
