import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

// The Christmas touches from Nov 20 to Jan 6 (src/features/season.ts). The fixture turns them off for every other spec.
test.use({ festive: true })

const DECEMBER = new Date(2026, 11, 16, 10, 0)

// Opens the first program's workout and logs a set of its first exercise, which starts it and a break.
const logSet = async (page: Page) => {
  await page.goto('/')
  await page.locator('.program-pick').first().click()
  await page.waitForURL('**/gymtime/?*')
  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-open-btn').click()
  const form = card.locator('.next-set-form')
  await form.locator('input[name="set-reps"]').fill('10')
  await form.locator('input[name="set-weight"]').fill('100')
  await form.getByRole('button', { name: 'Finished set' }).click()
  await expect(page).toHaveURL(/\/gymtime\/\?id=/)
  await expect(page.locator('#break-countdown-dialog')).toBeVisible()
}

test.describe('Christmas', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(DECEMBER)
    await seedDatabase(page)
  })

  test('dresses Home for Christmas, with an advent calendar waiting for today', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-season', 'christmas')
    await expect(page.getByRole('heading', { name: 'Ho ho ho, gymbro.' })).toBeVisible()
    await expect(page.locator('.season-snow i')).toHaveCount(24)

    const advent = page.locator('#advent')
    await expect(advent).toBeVisible()
    await expect(advent.locator('.advent-door')).toHaveCount(24)
    await expect(advent).toContainText('0 of 24 open')
    await expect(page.getByRole('button', { name: 'Door 16, today, opens with a workout' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Door 15, shut, no workout that day' })).toBeDisabled()

    // The hidden egg: a tap knocks the hat off.
    await page.getByRole('button', { name: 'Knock off the Santa hat' }).click()
    await expect(page.locator('#santa-hat')).toBeHidden()
  })

  test("a workout opens the day's advent door, with an elf line in its break", async ({ page }) => {
    await logSet(page)
    await expect(page.locator('#break-elf-line')).toBeVisible()
    await expect(page.locator('#break-elf-line')).not.toBeEmpty()
    await page.locator('#skip-break').click()

    await page.goto('/')
    await expect(page.locator('#advent')).toContainText('1 of 24 open')
    await page.getByRole('button', { name: 'Door 16, open' }).click()
    const sheet = page.locator('#advent-door-dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Door 16')
    await expect(sheet.getByRole('heading', { name: 'You lifted 1 tonne.' })).toBeVisible()
    await expect(sheet).toContainText('1 set')
    await sheet.getByRole('button', { name: 'Close dialog' }).click()
    await expect(sheet).toBeHidden()
  })

  test('stamps a gift tag on a finished workout, which the calendar wraps as a present', async ({ page }) => {
    await logSet(page)
    await page.locator('#skip-break').click()
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog.exercise-sheet[open]')).toHaveCount(0)
    await page.locator('#start-button').click()
    await page.locator('#finish-workout-dialog').getByRole('button', { name: 'Finish workout' }).click()
    const tag = page.locator('.confetti-text.confetti-tag')
    await expect(tag).toBeVisible()
    await expect(tag.locator('small')).toHaveText('Workout done!')

    await page.goto('/workouts/')
    const check = page.locator('.calendar-day[data-date="2026-12-16"] .calendar-check')
    await expect(check).toBeVisible()
    await expect(check).toHaveCSS('background-color', 'rgb(217, 58, 58)')
  })

  test('Settings turns the festive touches off and on', async ({ page }) => {
    await page.goto('/settings/')
    const festive = page.getByRole('switch', { name: /Festive touches/ })
    await expect(festive).toBeChecked()
    await festive.click()
    await expect(page.locator('html')).not.toHaveAttribute('data-season')
    await expect(page.locator('.season-snow')).toHaveCount(0)

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Hey, gymbro.' })).toBeVisible()
    await expect(page.locator('#advent')).toBeHidden()

    await page.goto('/settings/')
    await page.getByRole('switch', { name: /Festive touches/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-season', 'christmas')
  })
})

test('stays plain outside the Christmas season', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 19, 10, 0))
  await seedDatabase(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hey, gymbro.' })).toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-season')
  await expect(page.locator('#santa-hat')).toBeHidden()
  await expect(page.locator('#advent')).toBeHidden()
})
