import { expect, test, type Page } from '@playwright/test'
import { seedDatabase } from './seed'

// Stores a workout of Bench, with two sets to do, and logs the sets given.
const logBench = (page: Page, date: string, sets: Array<{ reps: number; weight: number }>) =>
  page.evaluate(
    async ({ date, sets }) => {
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      let session = await workoutSessionsStore.create({
        date,
        programId: 'program',
        location: '',
        exercises: [
          snapshotFromExercise({
            id: 'bench',
            name: 'Bench',
            kind: 'lifting',
            preset: 'lifting',
            muscle: 'chest',
            targetSets: 2,
            defaults: { reps: 5 },
            isDeleted: false,
            updatedAt: `${date}T12:00:00.000Z`
          })
        ]
      })
      for (const set of sets)
        session = await workoutSessionsStore.addSet(session, 'bench', { preset: 'lifting', ...set })
    },
    { date, sets }
  )

test.describe('Stats Page', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
  })

  test('counts the completed workouts and leaves out an unfinished one', async ({ page }) => {
    await page.goto('/stats/')
    await logBench(page, '2026-03-15', [
      { reps: 5, weight: 60 },
      { reps: 8, weight: 50 }
    ])
    await logBench(page, '2026-03-20', [{ reps: 10, weight: 100 }])
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()
    await expect(page.locator('#stat-completed-sessions')).toHaveText('1')
    // 5 × 60 + 8 × 50
    await expect(page.locator('#stat-total-volume')).toHaveText('700')
    await expect(page.locator('#stat-total-exercises')).toHaveText('1')
    await expect(page.locator('#stat-total-sets')).toHaveText('2')
    await expect(page.locator('#stat-total-reps')).toHaveText('13')
    await expect(page.locator('#stat-days-active')).toHaveText('1')
    // One workout over the shortest span counted, a day, is 7 a week.
    await expect(page.locator('#stat-avg-workouts')).toHaveText('7')
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
