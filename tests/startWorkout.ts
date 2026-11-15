import { expect, type Page } from '@playwright/test'

// Starts the workout the gymtime page shows. The first change starts it, so this adds a set to do to the first
// exercise from its sheet, and closes the sheet again.
export async function startWorkout(page: Page) {
  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-open-btn').click()
  await card.getByRole('button', { name: 'Add set' }).click()
  await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
  await expect(page).toHaveURL(/\/gymtime\/\?id=/)
  await card.getByRole('button', { name: 'Close dialog' }).click()
  await expect(card.locator('.exercise-sheet')).toHaveJSProperty('open', false)
}
