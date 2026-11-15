import { expect } from '@playwright/test'
import { test } from './fixtures'

test.describe('Portrait only', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('a phone held sideways hides the page and its dialog, and asks to turn it upright', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    const name = page.getByLabel('Name')
    await name.fill('Bench Press')
    const prompt = () => page.evaluate(() => getComputedStyle(document.body, '::after').content)
    expect(await prompt()).toBe('none')

    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.getByRole('heading', { name: 'Exercises', level: 1 })).toBeHidden()
    await expect(name).toBeHidden()
    expect(await prompt()).toBe('"Turn your phone upright to use Jimbro"')

    // Turned upright again, the dialog is still open with what was typed.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(name).toHaveValue('Bench Press')
    await expect(name).toBeVisible()
  })
})
