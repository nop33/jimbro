import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

// The router shows each page in the document already open, so whatever the test leaves on window survives a tap
// unless a page loaded in full.
const markDocument = (page: Page) => page.evaluate(() => Object.assign(window, { jimbroDocument: 'first' }))
const sameDocument = (page: Page) =>
  page.evaluate(() => (window as Window & { jimbroDocument?: string }).jimbroDocument === 'first')

// Without the Navigation API every tap loads the next page in full, which the other specs cover. The WebKit projects
// run without it (playwright.config.ts).
const skipWithoutRouter = async (page: Page) =>
  test.skip(
    !(await page.evaluate(() => (window as { navigation?: unknown }).navigation !== undefined)),
    'This browser loads every page in full'
  )

// Taps the element with the mouse alone, which Playwright's WebKit doesn't wait on, unlike a locator's click, which
// waits there for the navigation it can't see to end.
const tap = async (page: Page, locator: Locator) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Nothing to tap')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
// What the page shows, read from the page, since Playwright's page-level checks such as toHaveTitle wait in WebKit
// for a navigation it never sees end.
const shown = (page: Page) =>
  page.evaluate(() => ({
    path: location.pathname,
    title: document.title,
    current: document.querySelector('.bottom-nav a[aria-current="page"]')?.textContent?.trim(),
    scrollY: window.scrollY
  }))

test.beforeEach(async ({ page }) => {
  await seedDatabase(page)
})

test('a nav tap shows the next page in the same document, and Back brings the last one back where it was', async ({
  page
}) => {
  await page.goto('/exercises/')
  await skipWithoutRouter(page)
  await expect(page.getByText('Bench press')).toBeVisible()
  await markDocument(page)
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)

  await page.locator('.bottom-nav a', { hasText: 'Programs' }).click()
  await expect(page).toHaveURL(/\/programs\/$/)
  await expect(page).toHaveTitle('Jimbro - Programs')
  await expect(page.getByText('Push day')).toBeVisible()
  await expect(page.locator('.bottom-nav a[aria-current="page"]')).toHaveText('Programs')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  expect(await sameDocument(page)).toBe(true)

  await page.goBack()
  await expect(page).toHaveTitle('Jimbro - Exercises')
  await expect(page.getByText('Bench press')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)
  expect(await sameDocument(page)).toBe(true)
})

test('a break keeps counting down on the next page, and its bar opens the full timer there', async ({ page }) => {
  await page.goto('/workouts/')
  await skipWithoutRouter(page)
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

  // The history chart lives on gymtime, so off it the full timer offers the way back to the workout instead.
  await breakTimer.click()
  await expect(breakTimer).toHaveClass(/dialog-full-screen/)
  await expect(breakTimer.getByRole('button', { name: 'View exercise history' })).toBeHidden()
  await breakTimer.getByRole('link', { name: 'Back to workout' }).click()
  await expect(page).toHaveTitle('Jimbro - Gymtime')
  await expect(page).toHaveURL(/\/gymtime\/\?id=/)
  await expect(card.locator('.completed-sets .set.isCompleted')).toHaveCount(1)
  expect(await sameDocument(page)).toBe(true)
  await expect(breakTimer).toHaveClass(/dialog-minimized/)

  await breakTimer.click()
  await expect(breakTimer.getByRole('link', { name: 'Back to workout' })).toBeHidden()
  await expect(breakTimer.getByRole('button', { name: 'View exercise history' })).toBeVisible()
  await breakTimer.getByRole('button', { name: 'Skip' }).click()
  await expect(breakTimer).toBeHidden()
})

// Back stays with the Chromium test above: Playwright's WebKit leaves the entry of a navigation the router intercepts
// out of navigation.entries(), so Back there goes one page too far, and only Safari on a phone can say whether Safari
// does the same.
test.describe('with the Navigation API in every browser', () => {
  test.use({ navigationApi: true })

  test('a nav tap shows the next page in the same document, at its top', async ({ page }) => {
    await page.goto('/exercises/')
    await skipWithoutRouter(page)
    await expect(page.getByText('Bench press')).toBeVisible()
    await markDocument(page)
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400)

    await tap(page, page.locator('.bottom-nav a', { hasText: 'Programs' }))
    await expect
      .poll(() => shown(page))
      .toEqual({ path: '/programs/', title: 'Jimbro - Programs', current: 'Programs', scrollY: 0 })
    await expect.poll(() => page.evaluate(() => document.body.innerText)).toContain('Push day')
    expect(await sameDocument(page)).toBe(true)
  })
})

test('a page reached by its address, or reloaded, still loads in full and works', async ({ page }) => {
  await page.goto('/programs/')
  await expect(page.getByText('Push day')).toBeVisible()
  await markDocument(page)
  await page.reload()
  await expect(page.getByText('Push day')).toBeVisible()
  expect(await sameDocument(page)).toBe(false)
})
