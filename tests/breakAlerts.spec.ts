import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { claimUser } from './localWorker'
import { seedDatabase } from './seed'

// Playwright's browsers reach no push service and the dev server registers no service worker, so the page gets a
// stand-in: notifications allowed, and a subscription on a push service's URL. The specs check what the app sends the
// local worker, and worker/test/breakAlerts.spec.ts what the worker pushes.
const standInPush = (page: Page) =>
  page.addInitScript(() => {
    const p256dh = btoa(String.fromCharCode(4, ...Array.from({ length: 64 }, () => 1)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/playwright',
      toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }),
      unsubscribe: async () => true
    }
    // Each full page load runs this again, so what the user allowed and subscribed keeps in sessionStorage.
    let subscribed = sessionStorage.getItem('standIn.subscribed') === 'yes'
    const registration = {
      pushManager: {
        getSubscription: async () => (subscribed ? subscription : null),
        subscribe: async () => {
          subscribed = true
          sessionStorage.setItem('standIn.subscribed', 'yes')
          return subscription
        }
      }
    }
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    Object.defineProperty(window, 'Notification', {
      value: class {
        static get permission() {
          return sessionStorage.getItem('standIn.permission') ?? 'default'
        }
        static requestPermission = async () => {
          sessionStorage.setItem('standIn.permission', 'granted')
          return 'granted'
        }
      },
      configurable: true
    })
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve(registration) })
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => registration })
  })

const openWorkoutSettings = async (page: Page) => {
  await page.goto('/settings/')
  await page.locator('summary', { hasText: 'Workout Settings' }).click()
}

const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

test('break alerts wait for cloud backup', async ({ page }) => {
  await standInPush(page)
  await openWorkoutSettings(page)
  await expect(page.locator('#break-alerts-status')).toHaveText(/need cloud backup/)
  await expect(page.getByRole('button', { name: 'Turn on break alerts' })).toBeDisabled()
})

test('a break that goes out of sight asks the worker for an alert, and coming back cancels it', async ({ page }) => {
  const user = claimUser()
  await standInPush(page)
  await seedDatabase(page)
  await page.goto('/settings/')
  await page.locator('#cloud-backup-details > summary').click()
  await page.getByText('Use a token').click()
  await page.getByLabel('User ID').fill(user.userId)
  await page.getByLabel('Token').fill(user.token)
  await page.getByRole('button', { name: 'Save credentials' }).click()

  await openWorkoutSettings(page)
  const subscribed = page.waitForResponse((response) => response.url().endsWith('/api/break-alerts/subscribe'))
  await page.getByRole('button', { name: 'Turn on break alerts' }).click()
  expect((await subscribed).status()).toBe(200)
  await expect(page.locator('#break-alerts-status')).toHaveText(/^On\./)
  await expect(page.getByRole('button', { name: 'Turn off break alerts' })).toBeVisible()

  await page.goto('/')
  await page.locator('.program-pick').first().click()
  await page.waitForURL('**/gymtime/?*')
  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-details > summary').click()
  const form = card.locator('.next-set-form')
  await form.locator('input[name="set-reps"]').fill('10')
  await form.locator('input[name="set-weight"]').fill('100')
  await form.getByRole('button', { name: 'Finished set' }).click()
  await expect(page.locator('#break-countdown-dialog')).toBeVisible()

  const scheduled = page.waitForResponse((response) => response.url().endsWith('/api/break-alerts/schedule'))
  await setVisibility(page, 'hidden')
  const response = await scheduled
  expect(await response.json()).toEqual({ scheduled: true })
  const alert = response.request().postDataJSON() as { endsAt: number; title: string; body: string; url: string }
  expect(alert.title).toBe('Break over')
  expect(alert.body).toMatch(/^Next: /)
  expect(alert.url).toMatch(/^\/gymtime\/\?id=/)
  expect(alert.endsAt).toBeGreaterThan(Date.now())

  const cancelled = page.waitForResponse((response) => response.url().endsWith('/api/break-alerts/cancel'))
  await setVisibility(page, 'visible')
  expect((await cancelled).status()).toBe(200)
})
