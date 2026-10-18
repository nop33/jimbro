import { test, expect } from '@playwright/test'
import { seedDatabase } from './seed'

test('a tapped toast slides out before it leaves the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/exercises/')
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByLabel('Name').fill('Bench Press')
  await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
  await page.getByLabel('Default sets').fill('3')
  await page.getByLabel('Default reps').fill('10')
  await page.getByRole('button', { name: 'Save' }).click()

  const toast = page.locator('.toast-message-popup')
  await expect(toast).toHaveText('Exercise saved!')
  // The toast waits for its exit transitions, so it is still there, leaving, when the tap returns. The tap comes once
  // the toast has slid in, as a person sees it before tapping it.
  const leaving = await toast.evaluate(async (element: HTMLElement) => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await Promise.all(element.getAnimations().map(({ finished }) => finished))
    element.click()
    return {
      leaving: element.classList.contains('leaving'),
      transitions: element.getAnimations().length
    }
  })
  expect(leaving).toEqual({ leaving: true, transitions: 2 })
  await expect(toast).toHaveCount(0)
})

test('a card menu grows out of the corner by the button that opens it', async ({ page }) => {
  await seedDatabase(page)
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)

  const card = page.locator('#exercises-list > .card').first()
  const button = card.locator('.exercise-actions-btn')
  const menu = card.locator('.exercise-actions-menu')
  await button.click()
  await expect(menu).toBeVisible()

  // The first card's menu has room below its button, so it opens down from the button's bottom right corner.
  const buttonBox = await button.boundingBox()
  const menuBox = await menu.boundingBox()
  expect(menuBox!.y).toBeGreaterThan(buttonBox!.y)
  expect(await menu.evaluate((element) => element.style.transformOrigin)).toBe('right top')
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`minimizing the break timer morphs it into its bar only without reduced motion (${reducedMotion})`, async ({
    page
  }) => {
    await seedDatabase(page)
    await page.emulateMedia({ reducedMotion })
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await expect(page).toHaveURL(/\/gymtime\/\?programId=.+/)

    const card = page.locator('#exercises-list > .card').first()
    await card.locator('summary').click()
    const form = card.locator('.next-set-form')
    await form.locator('input[name="set-reps"]').fill('10')
    await form.locator('input[name="set-weight"]').fill('60')
    await form.getByRole('button', { name: 'Finished set' }).click()
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toHaveClass(/dialog-full-screen/)

    // The view transition groups that animate in the frames after the timer turns into its bar. The header and nav
    // morph with the page under it, since a group of their own would draw on top of the timer.
    const morphed = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const nextFrame = () => new Promise((done) => requestAnimationFrame(done))
          const groups = () =>
            document
              .getAnimations()
              .map((animation) => (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '')
              .filter((pseudo) =>
                /^::view-transition-group\((break-timer|countdown|app-header|bottom-nav)\)$/.test(pseudo)
              )
          void (async () => {
            while (!document.querySelector('#break-countdown-dialog.dialog-minimized')) await nextFrame()
            const seen = new Set<string>()
            for (let frame = 0; frame < 3; frame++) {
              groups().forEach((group) => seen.add(group))
              await nextFrame()
            }
            resolve([...seen].sort())
          })()
        })
    )
    await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    expect(await morphed).toEqual(
      reducedMotion === 'reduce' ? [] : ['::view-transition-group(break-timer)', '::view-transition-group(countdown)']
    )
    await expect(breakTimer).toHaveClass(/dialog-minimized/)
  })
}
