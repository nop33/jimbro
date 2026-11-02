import { expect, type Page } from '@playwright/test'

// Each test runs in a browser context of its own, so its database starts empty. This fills it with the sample
// exercises and programs, the way a new user does from the workouts page.
export const seedDatabase = async (page: Page) => {
  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'Start with the 3-day split' }).click()
  await expect(page.locator('.workout-week').first()).toBeVisible()
}
