import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

const startButton = (page: Page) => page.locator('#start-button')
const finishSheet = (page: Page) => page.locator('#finish-workout-dialog')

// The stored session the gymtime address names.
const storedSession = (page: Page) =>
  page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    const id = new URLSearchParams(window.location.search).get('id')
    return id ? workoutSessionsStore.getById(id) : undefined
  })

// Starts the workout Home suggests from the nav, and resolves to its program's name.
const startFromHome = async (page: Page) => {
  await page.goto('/')
  const name = (await page.locator('.program-pick[data-suggested] .program-pick-name').textContent())?.trim() ?? ''
  await page.getByRole('button', { name: 'Start next workout' }).click()
  await expect(page).toHaveURL(/\/gymtime\/\?id=/)
  await expect(page.locator('.app-header-title')).toHaveText(name)
  await expect(startButton(page)).toHaveAttribute('data-running', '')
  return name
}

test.describe('Start button', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
  })

  test('starts the workout Home suggests and shows how long it has run', async ({ page }) => {
    await startFromHome(page)
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(startButton(page).locator('.nav-start-time')).toHaveText(/^0:0\d$/)
    await expect(startButton(page)).toHaveAccessibleName(/^Finish workout, 0:\d\d in$/)

    const session = await storedSession(page)
    expect(session?.status).toBe('incomplete')
    expect(Date.now() - Date.parse(session?.startedAt ?? '')).toBeLessThan(60_000)

    // The time runs on every page.
    await page.goto('/exercises/')
    await expect(startButton(page)).toHaveAttribute('data-running', '')
    await expect(startButton(page).locator('.nav-start-time')).toHaveText(/^\d+:\d\d$/)
  })

  test('starts the workout the page shows before it starts', async ({ page }) => {
    await page.goto('/')
    const other = page.locator('.program-pick:not([data-suggested])').first()
    const name = (await other.locator('.program-pick-name').textContent())?.trim() ?? ''
    await other.click()
    await expect(page).toHaveURL(/\/gymtime\/\?programId=/)
    await expect(page.locator('.app-header-title')).toHaveText(name)
    await expect(page.locator('#exercises-list > .card').first()).toBeVisible()
    await expect(startButton(page)).not.toHaveAttribute('data-running')

    await startButton(page).click()
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(page.locator('.app-header-title')).toHaveText(name)
    await expect(startButton(page)).toHaveAttribute('data-running', '')
  })

  test('finishes the workout early on its page after asking', async ({ page }) => {
    await startFromHome(page)

    await startButton(page).click()
    const sheet = finishSheet(page)
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(/0 of \d+ exercises done/)
    // On the workout's own page there is nowhere to go.
    await expect(sheet.getByRole('link', { name: 'Go to workout' })).toBeHidden()

    // Closing it finishes nothing.
    await sheet.getByRole('button', { name: 'Close dialog' }).click()
    await expect(sheet).toBeHidden()
    expect((await storedSession(page))?.status).toBe('incomplete')

    await startButton(page).click()
    await sheet.getByRole('button', { name: 'Finish workout' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('.confetti-text')).toHaveText('Workout done!')
    await expect(startButton(page)).not.toHaveAttribute('data-running')
    await expect(startButton(page)).toHaveAccessibleName('Start next workout')

    const session = await storedSession(page)
    expect(session?.status).toBe('completed')
    expect(session?.finishedAt).toEqual(expect.any(String))
  })

  test('finishes the workout from another page, which shows it done', async ({ page }) => {
    const name = await startFromHome(page)
    await page.goto('/')
    const pick = page.locator('.program-pick', { hasText: name })
    await expect(pick).toHaveAttribute('data-status', 'incomplete')

    await startButton(page).click()
    const sheet = finishSheet(page)
    await expect(sheet.getByRole('link', { name: 'Go to workout' })).toHaveAttribute('href', /\/gymtime\/\?id=/)
    await sheet.getByRole('button', { name: 'Finish workout' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout finished')
    await expect(page.locator('.program-pick', { hasText: name })).toHaveAttribute('data-status', 'completed')
    await expect(startButton(page)).not.toHaveAttribute('data-running')
  })
})
