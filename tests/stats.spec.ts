import { expect, test } from '@playwright/test'
import { seedDatabase } from './seed'

test.describe('Stats Page', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
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
})

test.describe('Stats Page west of UTC', () => {
  test.use({ timezoneId: 'America/New_York' })

  test('shows the first workout on the day it was logged', async ({ page }) => {
    await page.goto('/stats/')
    await page.evaluate(async () => {
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const session = await workoutSessionsStore.create({
        date: '2026-03-15',
        programId: 'program',
        location: '',
        exercises: [
          snapshotFromExercise({
            id: 'bench',
            name: 'Bench',
            kind: 'lifting',
            preset: 'lifting',
            muscle: 'chest',
            targetSets: 1,
            defaults: { reps: 5 },
            isDeleted: false,
            updatedAt: '2026-03-15T12:00:00.000Z'
          })
        ]
      })
      await workoutSessionsStore.addSet(session, 'bench', { preset: 'lifting', reps: 5, weight: 60 })
    })
    await page.reload()
    // new Date('2026-03-15') is midnight UTC, which is still March 14 in New York.
    await expect(page.locator('#stat-since-date')).toHaveText('Mar 15, 2026')
  })
})
