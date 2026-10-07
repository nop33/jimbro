import { test, expect, type Page } from '@playwright/test'
import { PREVIEW_URL } from './preview'

// Only the build registers the service worker, so these tests open the preview server.
test.use({ baseURL: PREVIEW_URL })

const waitForServiceWorker = (page: Page) =>
  page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForServiceWorker(page)
})

test('every page opens offline from the bottom bar', async ({ page }) => {
  await page.context().setOffline(true)

  for (const [link, url, title] of [
    ['Workouts', '/workouts/', 'Workouts'],
    ['Exercises', '/exercises/', 'Exercises'],
    ['Programs', '/programs/', 'Programs'],
    ['Stats', '/stats/', 'Stats'],
    ['Home', '/', 'Hey, gymbro.']
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name: link }).click()
    await expect(page).toHaveURL(`${PREVIEW_URL}${url}`)
    await expect(page.locator('.app-header-title')).toContainText(title)
  }

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.locator('.app-header-title')).toContainText('Settings')
})

test('a workout started offline waits in the outbox', async ({ page }) => {
  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await expect(page.locator('.workout-week')).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'offline-user', token: 'offline-token' }))
  })

  await page.context().setOffline(true)
  await page.goto('/settings/')
  const status = page.locator('#cloud-summary-status')
  await expect(status).toHaveText(/^\d+ pending/)
  const before = parseInt((await status.textContent()) ?? '')

  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)
  await page.getByRole('button', { name: 'Save & start workout' }).click()
  await expect(page.locator('details.exercise-details').first()).toBeVisible()

  await page.goto('/settings/')
  await expect.poll(async () => parseInt((await status.textContent()) ?? '')).toBeGreaterThan(before)
})
