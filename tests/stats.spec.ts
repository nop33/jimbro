import { expect, test } from '@playwright/test'

test.describe('Stats Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workouts to seed database first
    await page.goto('/workouts/')
    const seedBtn = page.getByRole('button', { name: 'Seed Database' })
    if (await seedBtn.isVisible()) {
      await seedBtn.click()
      await expect(page.locator('.workout-week')).toBeVisible()
    }
  })

  test('displays correct statistics on the stats page', async ({ page }) => {
    await page.goto('/stats/')

    // Ensure the Stats page loaded
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()

    // Verify all stat values are rendered
    await expect(page.locator('#stat-completed-sessions')).toBeVisible()
    await expect(page.locator('#stat-total-volume')).toBeVisible()
    await expect(page.locator('#stat-total-exercises')).toBeVisible()
    await expect(page.locator('#stat-total-sets')).toBeVisible()
    await expect(page.locator('#stat-total-reps')).toBeVisible()
    await expect(page.locator('#stat-days-active')).toBeVisible()
    await expect(page.locator('#stat-avg-workouts')).toBeVisible()
  })

  test('stats link is present and active in the navigation menu', async ({ page }) => {
    await page.goto('/stats/')

    const statsLink = page.locator('.nav-link[href="/stats/"]')
    await expect(statsLink).toBeVisible()
    await expect(statsLink).toHaveClass(/active/)
  })
})
