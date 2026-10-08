import { expect, test, type Page } from '@playwright/test'
import { PREVIEW_URL } from './preview'

// Playwright turns the back/forward cache off unless the browser launches without this flag. The headless shell
// Playwright runs by default has no back/forward cache at all, so these tests run full Chromium, headless.
test.use({
  channel: 'chromium',
  launchOptions: async ({ launchOptions }, use) =>
    use({ ...launchOptions, ignoreDefaultArgs: ['--disable-back-forward-cache'] })
})

test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium lets a test turn the cache back on')

// The dev server's live-reload socket keeps every page out of the cache, so these tests open the build.
test.use({ baseURL: PREVIEW_URL })

// Each pageshow, in order, as 'restored' or 'loaded'. A read that a reload interrupts counts as none, and the poll
// asks again.
const pageShows = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('pageshows') ?? '[]') as Array<string>).catch(() => [])

// The service worker installs on the first page and then claims every page, which evicts a page already in the cache,
// so each test waits for it to take over first.
const serviceWorkerControls = (page: Page) => page.waitForFunction(() => navigator.serviceWorker.controller !== null)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      const shows = JSON.parse(sessionStorage.getItem('pageshows') ?? '[]') as Array<string>
      shows.push(`${location.pathname} ${event.persisted ? 'restored' : 'loaded'}`)
      sessionStorage.setItem('pageshows', JSON.stringify(shows))
    })
  })
})

test('Back restores the previous page from the back/forward cache', async ({ page }) => {
  await page.goto('/exercises/')
  await serviceWorkerControls(page)
  await page.locator('.bottom-nav a', { hasText: 'Programs' }).click()
  await expect(page).toHaveURL(/\/programs\/$/)
  // The programs page announces sync-settled, which used to evict the exercises page from the cache.
  await expect.poll(() => pageShows(page)).toEqual(['/exercises/ loaded', '/programs/ loaded'])

  await page.goBack({ waitUntil: 'commit' })
  await expect.poll(() => pageShows(page)).toEqual(['/exercises/ loaded', '/programs/ loaded', '/exercises/ restored'])
})

test('Back reloads the previous page when the database changed meanwhile', async ({ page }) => {
  await page.goto('/exercises/')
  await serviceWorkerControls(page)
  await expect.poll(() => pageShows(page)).toEqual(['/exercises/ loaded'])
  await page.locator('.bottom-nav a', { hasText: 'Workouts' }).click()
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await expect(page.locator('.workout-week').first()).toBeVisible()

  await page.goBack({ waitUntil: 'commit' })
  await expect
    .poll(() => pageShows(page))
    .toEqual([
      '/exercises/ loaded',
      '/workouts/ loaded',
      '/workouts/ loaded',
      '/exercises/ restored',
      '/exercises/ loaded'
    ])
  await expect(page.getByText('Bench press')).toBeVisible()
})
