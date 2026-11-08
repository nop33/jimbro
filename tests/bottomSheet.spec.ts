import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

// A finger on the screen, through Chromium's own touch input, so the browser decides between a scroll and a pull as it
// does on a phone. Playwright has no touch drag, and WebKit no CDP, so these run on Chromium only.
const drag = async (page: Page, from: { x: number; y: number }, by: number) => {
  const cdp = await page.context().newCDPSession(page)
  const steps = 8
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let step = 1; step <= steps; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x, y: from.y + (by * step) / steps }]
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

const centreOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('Bottom sheets', () => {
  test.use({ hasTouch: true })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch input goes through CDP, which only Chromium has.')

  test('a sheet closes when pulled down far enough, and slides back after a short pull', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    const sheet = page.locator('dialog#exercise-dialog')
    await expect(sheet).toBeVisible()
    const title = sheet.getByRole('heading', { name: 'New Exercise' })

    await drag(page, await centreOf(title), 30)
    await expect(sheet).toBeVisible()
    await expect.poll(() => sheet.evaluate((dialog) => dialog.style.translate)).toBe('')

    await drag(page, await centreOf(title), 300)
    await expect(sheet).toBeHidden()
  })

  test('a pull on a scrolled list scrolls it back before it closes the sheet', async ({ page }) => {
    await seedDatabase(page)
    await page.goto('/programs/')
    await page.locator('#programs-grid .program-card').first().click()
    await page.getByRole('button', { name: 'Add exercises' }).click()
    const sheet = page.locator('dialog#exercise-picker')
    await expect(sheet.locator('.exercise-choice').first()).toBeVisible()
    const body = sheet.locator('.dialog-sheet-body')
    await body.evaluate((element) => (element.scrollTop = 200))
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(200)

    await drag(page, await centreOf(body), 300)
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(sheet).toBeVisible()

    await drag(page, await centreOf(body), 300)
    await expect(sheet).toBeHidden()
  })

  test('a tap on the backdrop closes a sheet', async ({ page }) => {
    await page.goto('/programs/')
    await page.getByRole('button', { name: 'New' }).click()
    const sheet = page.locator('dialog#new-program-dialog')
    await expect(sheet).toBeVisible()
    await page.mouse.click(20, 20)
    await expect(sheet).toBeHidden()
  })
})

// The keyboard shrinks the visual viewport, which a spec can't open, so the page gets a stand-in it can shrink.
test('a sheet sits on the keyboard and fits above it', async ({ page }) => {
  await page.addInitScript(() => {
    const keyboard = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => keyboard })
    Object.assign(window, { keyboard })
  })
  await page.goto('/programs/')
  await page.getByRole('button', { name: 'New' }).click()
  const sheet = page.locator('dialog#new-program-dialog')
  await expect(sheet).toBeVisible()
  const height = await page.evaluate(() => window.innerHeight)
  const bottomOf = async () => sheet.evaluate((dialog) => Math.round(dialog.getBoundingClientRect().bottom))
  await expect.poll(bottomOf).toBe(height)

  await page.evaluate(() => {
    const { keyboard } = window as unknown as { keyboard: EventTarget & { height: number } }
    keyboard.height = window.innerHeight - 300
    keyboard.dispatchEvent(new Event('resize'))
  })
  await expect.poll(bottomOf).toBe(height - 300)
  await expect(sheet.getByRole('button', { name: 'Create' })).toBeInViewport()

  await page.evaluate(() => {
    const { keyboard } = window as unknown as { keyboard: EventTarget & { height: number } }
    keyboard.height = window.innerHeight
    keyboard.dispatchEvent(new Event('resize'))
  })
  await expect.poll(bottomOf).toBe(height)
})
