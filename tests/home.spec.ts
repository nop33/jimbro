import { test, expect, type Page } from '@playwright/test'
import { seedDatabase } from './seed'

// Friday 9 October 2026, so this week runs from Monday the 5th.
const NOW = new Date(2026, 9, 9, 10, 0)

// Starts a workout of the program at `index` on `date`, finished when `finished` is true. Resolves to the program.
const logWorkout = (page: Page, index: number, date: string, finished: boolean) =>
  page.evaluate(
    async ({ index, date, finished }) => {
      const { programsStore } = await import('/src/db/stores/programsStore.ts')
      const { snapshotFromExercise, workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
      const program = (await programsStore.load())[index]
      const bench = {
        id: 'home-bench',
        name: 'Bench',
        kind: 'lifting',
        preset: 'lifting',
        muscle: 'chest',
        targetSets: 1,
        defaults: { reps: 5 },
        isDeleted: false,
        updatedAt: '2026-10-01T12:00:00.000Z'
      } as const
      const session = await workoutSessionsStore.create({
        date,
        programId: program.id,
        location: '',
        exercises: [snapshotFromExercise(bench)]
      })
      if (finished) await workoutSessionsStore.addSet(session, bench.id, { preset: 'lifting', reps: 5, weight: 60 })
      return { id: program.id, name: program.name, sessionId: session.id }
    },
    { index, date, finished }
  )

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
  })

  test('shows the header, the empty week and a way to get started', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/Jimbro/)
    await expect(page.locator('h1')).toContainText('Hey, gymbro.')
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()

    await expect(page.locator('.week-day')).toHaveCount(7)
    await expect(page.locator('.week-day[aria-current="date"]')).toContainText('9')
    await expect(page.locator('#highlights')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Pick your workout' })).toBeHidden()
    await expect(page.getByText("Let's set up your first workout.")).toBeVisible()

    await page.getByRole('link', { name: 'Get started' }).click()
    await expect(page).toHaveURL(/\/workouts\/$/)
  })

  test('tracks the week and starts the suggested program', async ({ page }) => {
    await seedDatabase(page)
    const done = await logWorkout(page, 0, '2026-10-06', true)

    await page.goto('/')
    await expect(page.locator('#week-count')).toHaveText('1 of 3 workouts')
    await expect(page.locator('.week-day[data-status="completed"]')).toHaveCount(1)
    await expect(page.locator('#volume-value')).toHaveText('300 kg')
    await expect(page.locator('#streak-value')).toHaveText('0')

    const picks = page.locator('.program-pick')
    await expect(picks).toHaveCount(3)
    await expect(picks.last()).toHaveAttribute('data-status', 'completed')
    await expect(picks.last()).toContainText(done.name)

    // Push day is done, and Pull day comes next in the rotation, since neither of the others was ever done.
    expect(done.name).toBe('Push day')
    const suggested = page.locator('.program-pick[data-suggested]')
    await expect(suggested).toHaveCount(1)
    await expect(suggested).toContainText('Pull day')
    await expect(suggested).toContainText('Start ›')
    await suggested.click()
    await expect(page).toHaveURL('/gymtime/?programId=0eae96c5-954e-41fb-9f77-49ecc497ffc2')
  })

  test('opens Stats from any highlight, and Stats goes back home', async ({ page }) => {
    await seedDatabase(page)
    await logWorkout(page, 0, '2026-10-06', true)
    await page.goto('/')

    const tiles = page.locator('#highlights').getByRole('link')
    await expect(tiles).toHaveCount(3)
    for (const tile of await tiles.all()) await expect(tile).toHaveAttribute('href', '/stats/')

    await page.getByRole('link', { name: /lifted this week/ }).click()
    await expect(page).toHaveURL(/\/stats\/$/)
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('h1')).toContainText('Hey, gymbro.')
  })

  test('offers to continue a workout started this week', async ({ page }) => {
    await seedDatabase(page)
    const started = await logWorkout(page, 1, '2026-10-08', false)

    await page.goto('/')
    const suggested = page.locator('.program-pick[data-suggested]')
    await expect(suggested).toContainText(started.name)
    await expect(suggested).toContainText('Continue ›')
    await expect(suggested).toHaveAttribute('href', `/gymtime/?id=${started.sessionId}`)
  })
})
