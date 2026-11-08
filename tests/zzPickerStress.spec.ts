// TEMPORARY: repeats the exercise picker flow on desktop WebKit to catch its intermittent click timeout, and prints
// what the page does when a click can't find its target standing still. Removed before merge.
import { expect } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

test.describe.configure({ timeout: 600_000 })

test('stress the picker clicks on WebKit', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'webkit' || isMobile, 'desktop WebKit only')
  await seedDatabase(page)
  const sample = () =>
    page.evaluate(async () => {
      const samples: Array<unknown> = []
      for (let frame = 0; frame < 6; frame++) {
        const drawn = await Promise.race([
          new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true))),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
        ])
        const dialog = document.querySelector('dialog[open]')
        const r = (el: Element | null | undefined) => {
          const b = el?.getBoundingClientRect()
          return b && [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(',')
        }
        const body = dialog?.querySelector('.dialog-sheet-body')
        samples.push({
          drawn,
          dialog: r(dialog),
          dialogScroll: [dialog?.scrollTop, dialog?.scrollHeight, dialog?.clientHeight],
          submit: r(dialog?.querySelector('[type="submit"]')),
          body: [body?.scrollTop, body?.scrollHeight, body?.clientHeight, body?.clientWidth, body?.offsetWidth],
          chips: [dialog?.querySelector('#exercise-filter')?.scrollLeft, r(dialog?.querySelector('#exercise-filter'))],
          page: document.scrollingElement?.scrollTop,
          anims: document.getAnimations().length,
          vv: [visualViewport?.height, visualViewport?.offsetTop, innerHeight]
        })
      }
      return samples
    })
  let failures = 0
  for (let round = 0; round < 25; round++) {
    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('dialog#new-workout-dialog a.program-link').first().click()
    await expect(page.locator('#exercises-list > .card').first()).toBeVisible()
    await page.locator('#add-exercise-card').click()
    const picker = page.locator('#exercise-picker')
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: 'Close dialog' }).click()
    await page.locator('#add-exercise-card').click()
    const free = picker.locator('.exercise-choice:has(input:enabled) .exercise-choice-name')
    const [first, second] = (await free.allTextContents()).slice(0, 2).map((name) => name.trim())
    for (const [step, act] of [
      ['check second', () => picker.getByLabel(second, { exact: true }).check({ timeout: 4000 })],
      ['check first', () => picker.getByLabel(first, { exact: true }).check({ timeout: 4000 })],
      ['chip Back', () => picker.getByRole('radiogroup').getByText('Back', { exact: true }).click({ timeout: 4000 })],
      ['chip All', () => picker.getByRole('radiogroup').getByText('All', { exact: true }).click({ timeout: 4000 })],
      ['submit', () => picker.getByRole('button', { name: 'Add 2 exercises' }).click({ timeout: 4000 })]
    ] as const) {
      try {
        await act()
      } catch {
        failures++
        console.log(`STRESS round ${round} step ${step} timed out:`, JSON.stringify(await sample()))
        break
      }
    }
  }
  console.log(`STRESS failures: ${failures}`)
  expect(failures).toBe(0)
})
