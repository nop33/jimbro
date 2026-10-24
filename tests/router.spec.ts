import { expect, test, type Page } from '@playwright/test'
import { seedDatabase } from './seed'

// The router shows each page in the document already open, so whatever the test leaves on window survives a tap
// unless a page loaded in full.
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { jimbroDocument: 'first' }))
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as Window & { jimbroDocument?: string }).jimbroDocument === 'first')

test.skip(({ browserName }) => browserName !== 'chromium', 'WebKit here may lack the Navigation API and load in full')

test.beforeEach(async ({ page }) => {
  await seedDatabase(page)
})

test('a nav tap shows the next page in the same document, and Back brings the last one back where it was', async ({
  page
}) => {
  await page.goto('/exercises/')
  await expect(page.getByText('Bench press')).toBeVisible()
  await markDocument(page)
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)

  await page.locator('.bottom-nav a', { hasText: 'Programs' }).click()
  await expect(page).toHaveURL(/\/programs\/$/)
  await expect(page).toHaveTitle('Jimbro - Programs')
  await expect(page.getByText('Push day')).toBeVisible()
  await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveText('Programs')
  expect(await sameDocument(page)).toBe(true)

  await page.goBack()
  await expect(page).toHaveTitle('Jimbro - Exercises')
  await expect(page.getByText('Bench press')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)
  expect(await sameDocument(page)).toBe(true)
})

test('a break keeps counting down on the next page, and its bar opens the full timer there', async ({ page }) => {
  await page.goto('/workouts/')
  await page.locator('.workout-week').first().waitFor()
  await page.getByRole('button', { name: 'Add new workout' }).click()
  await page.locator('#programs-list a').first().click()
  await expect(page).toHaveURL(/\/gymtime\//)
  await markDocument(page)

  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-details > summary').click()
  const form = card.locator('.next-set-form')
  await form.locator('input[name="set-reps"]').fill('10')
  await form.locator('input[name="set-weight"]').fill('100')
  await form.getByRole('button', { name: 'Finished set' }).click()
  const breakTimer = page.locator('#break-countdown-dialog')
  await breakTimer.getByRole('button', { name: 'Minimize' }).click()
  await expect(breakTimer).toHaveClass(/dialog-minimized/)

  await page.locator('.bottom-nav a', { hasText: 'Exercises' }).click()
  // The old page stays on screen until the next one has drawn, and both list Bench press, so the title tells them apart.
  await expect(page).toHaveTitle('Jimbro - Exercises')
  await expect(page.getByText('Bench press')).toBeVisible()
  expect(await sameDocument(page)).toBe(true)
  await expect(breakTimer).toBeVisible()
  await expect(breakTimer).toHaveClass(/dialog-minimized/)
  const shown = await breakTimer.locator('#countdown').textContent()
  await expect(breakTimer.locator('#countdown')).not.toHaveText(shown ?? '')

  // The history chart lives on gymtime, so the full timer leaves it out here.
  await breakTimer.click()
  await expect(breakTimer).toHaveClass(/dialog-full-screen/)
  await expect(breakTimer.getByRole('button', { name: 'View exercise history' })).toBeHidden()
  await breakTimer.getByRole('button', { name: 'Skip' }).click()
  await expect(breakTimer).toBeHidden()
})
