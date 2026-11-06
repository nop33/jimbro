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

const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)

const signIn = async (page: Page) => {
  const user = claimUser()
  await page.goto('/settings/')
  await page.locator('#cloud-backup-details > summary').click()
  await page.getByText('Use a token').click()
  await page.getByLabel('User ID').fill(user.userId)
  await page.getByLabel('Token').fill(user.token)
  await page.getByRole('button', { name: 'Save credentials' }).click()
  // Saving waits for the account switch, so leaving before Sync now shows can drop the credentials.
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
}

// Opens the first program's workout and logs a set of its first exercise, which starts a break.
const startBreak = async (page: Page) => {
  await page.goto('/')
  await page.locator('.program-pick').first().click()
  await page.waitForURL('**/gymtime/?*')
  await logSet(page)
}

const logSet = async (page: Page) => {
  const card = page.locator('#exercises-list > .card').first()
  const form = card.locator('.next-set-form')
  if (!(await form.isVisible())) await card.locator('.exercise-details > summary').click()
  await form.locator('input[name="set-reps"]').fill('10')
  await form.locator('input[name="set-weight"]').fill('100')
  await form.getByRole('button', { name: 'Finished set' }).click()
  await expect(page.locator('#break-countdown-dialog')).toBeVisible()
}

test('without cloud backup the bell is struck through and says what it needs', async ({ page }) => {
  await standInPush(page)
  await seedDatabase(page)
  await startBreak(page)
  const timer = page.locator('#break-countdown-dialog')
  const bell = timer.getByRole('button', { name: 'Break alerts' })
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await expect(timer.locator('#break-alerts-offer')).toBeHidden()
  await bell.click()
  await expect(timer.getByRole('status')).toHaveText(/need cloud backup/)
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
})

test('a break offers the alerts, and once on, a break out of sight asks the worker for one', async ({ page }) => {
  await standInPush(page)
  await seedDatabase(page)
  await signIn(page)
  await startBreak(page)

  const timer = page.locator('#break-countdown-dialog')
  const bell = timer.getByRole('button', { name: 'Break alerts' })
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  const offer = timer.locator('#break-alerts-offer')
  await expect(offer).toBeVisible()
  const subscribed = page.waitForResponse((response) => response.url().endsWith('/api/break-alerts/subscribe'))
  await offer.getByRole('button', { name: 'Turn on' }).click()
  expect((await subscribed).status()).toBe(200)
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  await expect(timer.getByRole('status')).toHaveText('Break alerts on.')
  await expect(offer).toBeHidden()

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

  // The bell turns them off again.
  const unsubscribed = page.waitForResponse((response) => response.url().endsWith('/api/break-alerts/unsubscribe'))
  await bell.click()
  expect((await unsubscribed).status()).toBe(200)
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await expect(timer.getByRole('status')).toHaveText('Break alerts off.')

  // Turning them off was a choice, so the next break doesn't offer them again.
  await timer.getByRole('button', { name: 'Skip' }).click()
  await logSet(page)
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await expect(timer.locator('#break-alerts-offer')).toBeHidden()
})

test('"Not now" keeps the offer away from the next breaks', async ({ page }) => {
  await standInPush(page)
  await seedDatabase(page)
  await signIn(page)
  await startBreak(page)

  const timer = page.locator('#break-countdown-dialog')
  const offer = timer.locator('#break-alerts-offer')
  await offer.getByRole('button', { name: 'Not now' }).click()
  await expect(offer).toBeHidden()
  await timer.getByRole('button', { name: 'Skip' }).click()
  await expect(timer).toBeHidden()

  await logSet(page)
  await expect(timer.getByRole('button', { name: 'Break alerts' })).toHaveAttribute('aria-pressed', 'false')
  await expect(offer).toBeHidden()
})
