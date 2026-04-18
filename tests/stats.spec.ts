import { expect, test } from '@playwright/test'

test.describe('Stats Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to settings to seed database first
    await page.goto('/settings/')
    const seedBtn = page.getByRole('button', { name: 'Seed Database' })
    if (await seedBtn.isVisible()) {
      await seedBtn.click()
      await expect(seedBtn).toBeHidden()
    }
  })

  test('displays correct statistics on the stats page', async ({ page }) => {
    await page.goto('/stats/')

    // Ensure the Stats page loaded
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()

    // Test for Workout Sessions
    const sessionsCard = page.locator('.card', { hasText: 'Workout Sessions' })
    await expect(sessionsCard).toBeVisible()

    // There might be some numbers depending on how the seed data is shaped,
    // we can at least assert that they are rendered.
    const sessionsValue = sessionsCard.locator('.text-4xl.font-bold')
    await expect(sessionsValue).not.toBeEmpty()

    // Test for Total Volume
    const volumeCard = page.locator('.card', { hasText: 'Total Volume' })
    await expect(volumeCard).toBeVisible()
    const volumeValue = volumeCard.locator('.text-4xl.font-bold')
    await expect(volumeValue).not.toBeEmpty()

    // Test for Exercises
    const exercisesCard = page.locator('.card', { hasText: 'Exercises' })
    await expect(exercisesCard).toBeVisible()
    await expect(exercisesCard.locator('.text-3xl.font-bold')).not.toBeEmpty()

    // Test for Sets
    const setsCard = page.locator('.card', { hasText: 'Sets' })
    await expect(setsCard).toBeVisible()
    await expect(setsCard.locator('.text-3xl.font-bold')).not.toBeEmpty()

    // Test for Reps
    const repsCard = page.locator('.card', { hasText: 'Total Reps' })
    await expect(repsCard).toBeVisible()
    await expect(repsCard.locator('.text-3xl.font-bold')).not.toBeEmpty()

    // Test for Days Active
    const daysActiveCard = page.locator('.card', { hasText: 'Days Active' })
    await expect(daysActiveCard).toBeVisible()
    await expect(daysActiveCard.locator('.text-3xl.font-bold')).not.toBeEmpty()

    // Test for Avg Workouts/Wk
    const avgWorkoutsCard = page.locator('.card', { hasText: 'Avg Workouts/Wk' })
    await expect(avgWorkoutsCard).toBeVisible()
    await expect(avgWorkoutsCard.locator('.text-3xl.font-bold')).not.toBeEmpty()
  })

  test('stats link is present and active in the navigation menu', async ({ page }) => {
    await page.goto('/stats/')

    const statsLink = page.locator('.nav-link[href="/stats/"]')
    await expect(statsLink).toBeVisible()
    await expect(statsLink).toHaveClass(/active/)
  })
})
