import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { PREVIEW_HOST, PREVIEW_PORT } from './preview'
import { startWorkout } from './startWorkout'

// Only the build registers the service worker, so each test opens the preview server through its own proxy and
// closes the proxy to go offline. WebKit's emulated offline mode also stops the service worker from answering, so
// the server really has to go away. A port per test also gives each test its own origin, worker and database.
const openPreview = async () => {
  // After deploy(), the proxy serves a next build: a service worker of another version, whose Chart.js chunk has
  // another name, and the old chunk is gone from the server, as after a real deploy.
  let deployed = false
  const proxy = createServer((incoming, outgoing) => {
    const url = incoming.url ?? '/'
    if (deployed && url.startsWith('/assets/auto-')) {
      outgoing.writeHead(404).end()
      return
    }
    // The next service worker is rewritten below, so it comes whole and uncompressed.
    const headers = { ...incoming.headers }
    if (deployed && url === '/sw.js') {
      delete headers['accept-encoding']
      delete headers['if-none-match']
      delete headers['if-modified-since']
    }
    const upstream = request(
      {
        host: PREVIEW_HOST,
        port: PREVIEW_PORT,
        path: deployed ? url.replace('/assets/next-auto-', '/assets/auto-') : url,
        method: incoming.method,
        headers
      },
      (response) => {
        if (!(deployed && url === '/sw.js')) {
          outgoing.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(outgoing)
          return
        }
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const next = Buffer.concat(chunks)
            .toString()
            .replace(/"[0-9a-f]{16}"/g, '"0000000000000000"')
            .replaceAll('/assets/auto-', '/assets/next-auto-')
          outgoing.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }).end(next)
        })
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
  const deploy = () => {
    deployed = true
  }
  return { origin, goOffline, deploy }
}

const NEXT_BUILD_CACHE = 'jimbro-0000000000000000'

// Listens for the next build taking over the page, which the page may hear a moment after the browser installed it.
// Call it before deploy(), since the browser may find the next build on its own, as it checks on each full page load.
const watchForTakeOver = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as { tookOver: Promise<void> }).tookOver = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', async () => {
        if ((await caches.keys()).includes('jimbro-0000000000000000')) resolve()
      })
    })
  })

// Asks for the next build, and waits until the page heard it take over.
const takeOver = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    // An update the browser runs already makes this one fail, and the page still hears that one take over.
    await registration.update().catch(() => undefined)
    await (window as unknown as { tookOver: Promise<void> }).tookOver
  })

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
    ['Home', '/', 'Hey, gymbro.']
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name: link }).click()
    await expect(page).toHaveURL(`${origin}${path}`)
    await expect(page.locator('.app-header-title')).toContainText(title)
  }

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.locator('.app-header-title')).toContainText('Settings')

  // Stats has no nav link: Home's highlight tiles open it, and they show only once a workout exists.
  await page.goto(`${origin}/stats/`)
  await expect(page.locator('.app-header-title')).toContainText('Stats')
})

test('a workout started offline waits in the outbox', async ({ page }) => {
  const { origin, goOffline } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)
  await page.getByRole('button', { name: 'Start with the 3-day split' }).click()
  await expect(page.locator('.workout-week')).toBeVisible()
  // The test worker doesn't know this token, so a sync that still reaches it fails and the rows stay queued.
  await page.goto(`${origin}/settings/backup/`)
  await page.getByText('Use a token').click()
  await page.getByLabel('User ID').fill('offline-user')
  await page.getByLabel('Token').fill('offline-token')
  await page.getByRole('button', { name: 'Save credentials' }).click()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()

  goOffline()
  await page.goto(`${origin}/settings/`)
  const status = page.locator('#cloud-summary-status')
  // The 21 sample exercises and 3 programs.
  await expect(status).toHaveText('24 pending')

  await page.goto(`${origin}/workouts/`)
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)
  // The exercise cards show before the start, so wait for the start itself before leaving the page.
  await startWorkout(page)

  // Starting the workout with a set to do stores its header, and no set row yet.
  await page.goto(`${origin}/settings/`)
  await expect(status).toHaveText('25 pending')
})

test('a page that opened before a deploy still draws the history chart', async ({ page }) => {
  const { origin, deploy } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)
  await page.getByRole('button', { name: 'Start with the 3-day split' }).click()
  // The sample programs draw the page again once stored, which would take a dialog opened before it with the old page.
  await expect(page.getByRole('button', { name: 'Start with the 3-day split' })).toBeHidden()
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)

  // The next build's service worker takes over this page, which still runs the build it opened with: an open dialog
  // keeps the app from reloading into the new build.
  await page.locator('#add-exercise-card').click()
  const addExerciseDialog = page.locator('#add-exercise-dialog')
  await expect(addExerciseDialog).toBeVisible()
  await watchForTakeOver(page)
  deploy()
  await takeOver(page)
  await addExerciseDialog.locator('.close-dialog-btn').click()
  await expect(addExerciseDialog).toBeHidden()

  const firstExercise = page.locator('details.exercise-details').first()
  await firstExercise.locator('summary').click()
  const chartDrawn = page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#exercise-history-chart')
    return canvas !== null && canvas.width > 0 && canvas.hasAttribute('style')
  })
  await firstExercise.locator('.view-history-btn').click()
  await expect(page.locator('#exercise-history-dialog')).toBeVisible()
  await chartDrawn
})

// The app checks for a new build as it comes back into view, as when the lifter switches back to it.
const comeBackIntoView = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

const newBuildCached = (page: Page) =>
  page.evaluate(async (cache) => (await caches.keys()).includes(cache), NEXT_BUILD_CACHE)

test('a new build replaces the page as the app comes back into view', async ({ page }) => {
  const { origin, deploy } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)

  deploy()
  const reloaded = page.waitForEvent('load')
  await comeBackIntoView(page)
  await reloaded
  await expect(page.locator('.app-header-title')).toContainText('Workouts')
  expect(await newBuildCached(page)).toBe(true)
})

test('a new build waits until no dialog is open', async ({ page }) => {
  const { origin, deploy } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)
  await page.getByRole('button', { name: 'New' }).click()
  const dialog = page.locator('dialog#new-workout-dialog')
  await expect(dialog).toBeVisible()

  await watchForTakeOver(page)
  deploy()
  await comeBackIntoView(page)
  await takeOver(page)
  // The new build took over, and the open dialog stays as it was.
  expect(await newBuildCached(page)).toBe(true)
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const reloaded = page.waitForEvent('load')
  await comeBackIntoView(page)
  await reloaded
  await expect(page.locator('.app-header-title')).toContainText('Workouts')
})

// A document that opened before any service worker controlled it, as at an installed app's first launch, hears the
// first service worker take over from its own build. The next takeover is a new build, so the next tap loads in full.
test('a tap after a new build took over loads the next page in full', async ({ page }) => {
  const { origin, deploy } = await openPreview()
  await page.goto(`${origin}/workouts/`)
  await waitForServiceWorker(page)
  await page.getByRole('button', { name: 'New' }).click()
  const dialog = page.locator('dialog#new-workout-dialog')
  await expect(dialog).toBeVisible()

  await watchForTakeOver(page)
  deploy()
  await takeOver(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const loaded = page.waitForEvent('load')
  await page.locator('.bottom-nav').getByRole('link', { name: 'Exercises' }).click()
  await loaded
  await expect(page.locator('.app-header-title')).toContainText('Exercises')
})
