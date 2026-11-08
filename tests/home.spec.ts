import { expect } from '@playwright/test'
import { test } from './fixtures'
import { logWorkout } from './logWorkout'
import { seedDatabase } from './seed'

// Friday 9 October 2026, so this week runs from Monday the 5th.
const NOW = new Date(2026, 9, 9, 10, 0)

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

  test('shows last week by now until this week has lifted, then compares', async ({ page }) => {
    await seedDatabase(page)
    // Tuesday last week, so it counts toward last week up to Friday.
    await logWorkout(page, 0, '2026-09-29', true)

    await page.goto('/')
    const delta = page.locator('#volume-delta')
    await expect(page.locator('#volume-value')).toHaveText('0 kg')
    await expect(delta).toHaveText('Last week by now: 300 kg')
    await expect(delta).not.toHaveAttribute('data-trend')

    await logWorkout(page, 1, '2026-10-06', true)
    await page.reload()
    await expect(page.locator('#volume-value')).toHaveText('300 kg')
    await expect(delta).toHaveText('= 0% vs last week')
    await expect(delta).toHaveAttribute('data-trend', 'flat')
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

  test('counts a fourth workout toward next week, which then needs two', async ({ page }) => {
    await seedDatabase(page)
    // Push, Pull and Legs this week, and Push again on Sunday 11 October ahead of a busy week.
    await logWorkout(page, 0, '2026-10-05', true)
    await logWorkout(page, 1, '2026-10-06', true)
    await logWorkout(page, 2, '2026-10-07', true)

    await page.clock.setFixedTime(new Date(2026, 9, 11, 10, 0))
    await page.goto('/')
    const extra = page.locator('.program-pick[data-suggested][data-extra]')
    await expect(extra).toContainText('Push day')
    await expect(extra).toContainText('Extra ›')
    await logWorkout(page, 0, '2026-10-11', true)

    await page.reload()
    await expect(page.locator('#week-count')).toHaveText('3 of 3 workouts')
    await expect(page.locator('#week-carry')).toHaveText('+1 workout toward next week')
    await expect(page.locator('#week-goal .extra')).toHaveCount(1)

    // Monday: the Push done ahead counts, and the rotation goes on with Pull.
    await page.clock.setFixedTime(new Date(2026, 9, 12, 10, 0))
    await page.goto('/')
    await expect(page.locator('#week-count')).toHaveText('1 of 3 workouts')
    await expect(page.locator('#week-carry')).toHaveText('1 workout done ahead last week')
    await expect(page.locator('.program-pick', { hasText: 'Push day' })).toContainText('Done ahead Sun, Oct 11')
    await expect(page.locator('.program-pick[data-suggested]')).toContainText('Pull day')

    // Two workouts in the busy week keep the streak.
    await logWorkout(page, 1, '2026-10-14', true)
    await logWorkout(page, 2, '2026-10-16', true)
    await page.clock.setFixedTime(new Date(2026, 9, 19, 10, 0))
    await page.goto('/')
    await expect(page.locator('#streak-value')).toHaveText('🔥 2')
  })
})
