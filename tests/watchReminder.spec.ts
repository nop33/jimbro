import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

test.use({ watchReminder: true })

// Opens a program from Home on gymtime, a workout not started yet, with its first card open. A program with a workout
// under way this week opens that one, so each new workout takes another program.
const openProgram = async (page: Page, index = 0) => {
  await page.goto('/')
  await page.locator('.program-pick').nth(index).click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=/)
  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-details > summary').click()
  return card
}

const sheetOf = (page: Page) => page.locator('#watch-reminder-dialog')

test.describe('Watch reminder', () => {
  test.beforeEach(async ({ page }) => {
    await seedDatabase(page)
  })

  test('asks to start the watch before the first change starts the workout', async ({ page }) => {
    const card = await openProgram(page)
    await card.getByRole('button', { name: 'Add set' }).click()

    const sheet = sheetOf(page)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Start your watch' })).toBeFocused()
    await expect(sheet.getByRole('checkbox', { name: "Don't remind me again" })).not.toBeChecked()

    // Closing it saves nothing: the workout has not started.
    await sheet.getByRole('button', { name: 'Close dialog' }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/gymtime\/\?programId=/)
    await expect(page.locator('#delete-workout-session-btn')).toBeHidden()
    await expect(page.locator('.toast-message-popup')).toHaveCount(0)

    // Start workout goes on with the change, which starts the workout.
    await card.getByRole('button', { name: 'Add set' }).click()
    await sheet.getByRole('button', { name: 'Start workout' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)

    // Once started, later changes don't ask.
    const pending = card.locator('.completed-sets .set.isPending')
    const before = await pending.count()
    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(pending).toHaveCount(before + 1)
    await expect(sheet).toBeHidden()

    // The next workout asks again.
    const next = await openProgram(page, 1)
    await next.getByRole('button', { name: 'Add set' }).click()
    await expect(sheet).toBeVisible()
  })

  test("Don't remind me again stops asking until Settings turns it back on", async ({ page }) => {
    await page.goto('/settings/')
    const toggle = page.getByRole('switch', { name: /Watch reminder/ })
    await expect(toggle).toBeChecked()

    const card = await openProgram(page)
    await card.getByRole('button', { name: 'Add set' }).click()
    const sheet = sheetOf(page)
    await sheet.getByRole('checkbox', { name: "Don't remind me again" }).check()
    await sheet.getByRole('button', { name: 'Start workout' }).click()
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)

    // The next workout starts without asking.
    const next = await openProgram(page, 1)
    await next.getByRole('button', { name: 'Add set' }).click()
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(sheet).toBeHidden()

    // Settings shows the reminder off, and a tap on its row turns it back on.
    await page.goto('/settings/')
    await expect(toggle).not.toBeChecked()
    await page.locator('label.settings-row', { hasText: 'Watch reminder' }).click()
    await expect(toggle).toBeChecked()

    const again = await openProgram(page, 2)
    await again.getByRole('button', { name: 'Add set' }).click()
    await expect(sheet).toBeVisible()
  })

  test('a workout for another day starts without asking', async ({ page }) => {
    const card = await openProgram(page)
    await page.locator('#workout-details > summary').click()
    const date = page.locator('#workout-details input[name="date"]')
    const yesterday = await page.evaluate(async () => {
      const { getSimpleDate } = await import('/src/dateUtils.ts')
      const day = new Date()
      day.setDate(day.getDate() - 1)
      return getSimpleDate(day)
    })
    await date.fill(yesterday)
    await date.dispatchEvent('change')
    await card.getByRole('button', { name: 'Add set' }).click()
    await expect(page).toHaveURL(/\/gymtime\/\?id=/)
    await expect(sheetOf(page)).toBeHidden()
  })
})
