import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

const rootOverflow = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).overflowY)

// A finger on the screen, through Chromium's own touch input, so the browser scrolls as it does on a phone.
const swipe = async (page: Page, from: { x: number; y: number }, by: number) => {
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

// The page holds still under every dialog that covers it, the exercise sheet too, which opens without being modal, and
// is free again under the minimized break timer, which leaves the page to the lifter.
test('the page under an open dialog does not scroll, and scrolls again once it closes', async ({ page }) => {
  await seedDatabase(page)
  await page.getByRole('button', { name: 'New' }).click()
  const newWorkout = page.locator('dialog#new-workout-dialog')
  await expect(newWorkout).toBeVisible()
  await expect.poll(() => rootOverflow(page)).toBe('hidden')
  await newWorkout.locator('a.program-pick').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)
  await expect.poll(() => rootOverflow(page)).toBe('visible')

  const card = page.locator('#exercises-list > .card').first()
  const sheet = card.locator('.exercise-sheet')
  const form = card.locator('.next-set-form')
  await card.locator('.exercise-open-btn').click()
  await expect(sheet).toHaveJSProperty('open', true)
  await expect.poll(() => rootOverflow(page)).toBe('hidden')

  await form.locator('input[name="set-reps"]').fill('10')
  await form.locator('input[name="set-weight"]').fill('100')
  await form.getByRole('button', { name: 'Finished set' }).click()
  const breakTimer = page.locator('#break-countdown-dialog')
  await expect(breakTimer).toHaveClass(/dialog-full-screen/)
  await expect.poll(() => rootOverflow(page)).toBe('hidden')
  await breakTimer.getByRole('button', { name: 'Minimize' }).click()
  await expect(breakTimer).toHaveClass(/dialog-minimized/)
  await expect.poll(() => rootOverflow(page)).toBe('hidden')

  await card.getByRole('button', { name: 'Close dialog' }).click()
  await expect(sheet).toHaveJSProperty('open', false)
  await expect(breakTimer).toBeVisible()
  await expect.poll(() => rootOverflow(page)).toBe('visible')
})

test.describe('A swipe behind a sheet', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 700 } })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch input goes through CDP, which only Chromium has.')

  test('leaves the page where it was, and scrolls it once the sheet closes', async ({ page }) => {
    await seedDatabase(page)
    await page.goto('/exercises/')
    await expect(page.locator('#exercises-grid > *').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 300)).toBe(true)

    // The page is scrolled down a little behind the sheet, so a swipe either way would move it.
    await page.getByRole('button', { name: 'New' }).click()
    const sheet = page.locator('dialog#exercise-dialog')
    await expect(sheet).toBeVisible()
    await page.evaluate(() => scrollTo(0, 100))
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(100)
    await swipe(page, { x: 200, y: 60 }, -50)
    await swipe(page, { x: 200, y: 60 }, 50)
    await swipe(page, { x: 200, y: 400 }, -250)
    expect(await page.evaluate(() => scrollY)).toBe(100)

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    expect(await page.evaluate(() => scrollY)).toBe(100)
    await swipe(page, { x: 200, y: 400 }, -250)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100)
  })
})
