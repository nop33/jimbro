import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, type Page } from '@playwright/test'
import { PREVIEW_PORT } from './preview'

// Only the build registers the service worker, so each test opens the preview server through its own proxy and
// closes the proxy to go offline. WebKit's emulated offline mode also stops the service worker from answering, so
// the server really has to go away. A port per test also gives each test its own origin, worker and database.
const openPreview = async () => {
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      { host: 'localhost', port: PREVIEW_PORT, path: incoming.url, method: incoming.method, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      }
    )
    upstream.on('error', () => outgoing.destroy())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve) => proxy.listen(0, 'localhost', resolve))
  const origin = `http://localhost:${(proxy.address() as AddressInfo).port}`
  const goOffline = () => {
    proxy.close()
    proxy.closeAllConnections()
  }
  return { origin, goOffline }
}

const waitForServiceWorker = (page: Page) =>
  page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

test('every page opens offline from the bottom bar', async ({ page }) => {
  const { origin, goOffline } = await openPreview()
  await page.goto(`${origin}/`)
  await waitForServiceWorker(page)
  goOffline()

  for (const [link, path, title] of [
    ['Workouts', '/workouts/', 'Workouts'],
    ['Exercises', '/exercises/', 'Exercises'],
    ['Programs', '/programs/', 'Programs'],
    ['Stats', '/stats/', 'Stats'],
    ['Home', '/', 'Hey, gymbro.']
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name: link }).click()
    await expect(page).toHaveURL(`${origin}${path}`)
    await expect(page.locator('.app-header-title')).toContainText(title)
  }

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.locator('.app-header-title')).toContainText('Settings')
})

test('a workout started offline waits in the outbox', async ({ page }) => {
  const { origin, goOffline } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await expect(page.locator('.workout-week')).toBeVisible()
  // The test worker doesn't know this token, so a sync that still reaches it fails and the rows stay queued.
  await page.evaluate(() => {
    localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'offline-user', token: 'offline-token' }))
  })

  goOffline()
  await page.goto(`${origin}/settings/`)
  const status = page.locator('#cloud-summary-status')
  await expect(status).toHaveText(/^\d+ pending/)
  const before = parseInt((await status.textContent()) ?? '')

  await page.goto(`${origin}/workouts/`)
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)
  await page.getByRole('button', { name: 'Save & start workout' }).click()
  // The exercise cards show before the save, so wait for the save itself before leaving the page.
  await expect(page.locator('.toast-message-popup')).toContainText('Workout session saved')

  await page.goto(`${origin}/settings/`)
  await expect.poll(async () => parseInt((await status.textContent()) ?? '')).toBeGreaterThan(before)
})
