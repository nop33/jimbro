import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
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

  test('counts every logged set, and only completed workouts as workouts', async ({ page }) => {
    await page.goto('/stats/')
    await logBench(page, '2026-03-15', [
      { reps: 5, weight: 60 },
      { reps: 8, weight: 50 }
    ])
    await logBench(page, '2026-03-20', [{ reps: 10, weight: 100 }])
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()
    await expect(page.locator('#stat-completed-sessions')).toHaveText('1')
    await expect(page.locator('#stat-uncompleted-sessions')).toHaveText('+1 incomplete')
    // 5 × 60 + 8 × 50, and the unfinished workout's 10 × 100
    await expect(page.locator('#stat-total-volume')).toHaveText('1,700')
    await expect(page.locator('#stat-total-exercises')).toHaveText('2')
    await expect(page.locator('#stat-total-sets')).toHaveText('3')
    await expect(page.locator('#stat-total-reps')).toHaveText('23')
    await expect(page.locator('#stat-days-active')).toHaveText('2')
    // One completed workout over the calendar weeks from mid-March 2026 through this week.
    const weeks = await page.evaluate(() => {
      const monday = (day: Date) =>
        new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7))
      return Math.round((monday(new Date()).getTime() - monday(new Date(2026, 2, 15)).getTime()) / (7 * 864e5)) + 1
    })
    await expect(page.locator('#stat-avg-workouts')).toHaveText(
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(1 / weeks)
    )
  })

  test('shades the last twelve months by sets or volume, and names a tapped day', async ({ page }) => {
    await page.goto('/stats/')
    const today = await page.evaluate(async () => {
      const { getSimpleDate } = await import('/src/dateUtils.ts')
      return getSimpleDate(new Date())
    })
    await logBench(page, today, [
      { reps: 5, weight: 60 },
      { reps: 8, weight: 50 }
    ])
    await page.reload()

    const map = page.locator('#activity-map')
    const summary = page.locator('#activity-summary')
    await expect(summary).toHaveText('2 sets on 1 day')
    const todayCell = map.locator(`[data-date="${today}"]`)
    await expect(todayCell).toHaveAttribute('aria-current', 'date')
    await expect(todayCell).toHaveAttribute('data-level', '4')
    await expect(map.locator('.activity-cell[data-level="0"]').first()).toBeVisible()

    // The radios are hidden inside their labels, which take the tap.
    await page.locator('.activity-metric').getByText('Volume').click()
    await expect(page.getByRole('radio', { name: 'Volume' })).toBeChecked()
    // 5 × 60 + 8 × 50
    await expect(summary).toHaveText('700 kg on 1 day')

    await todayCell.click()
    await expect(summary).toContainText('· 700 kg')
    await expect(todayCell).toHaveAttribute('data-selected', '')
    await todayCell.click()
    await expect(summary).toHaveText('700 kg on 1 day')
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
