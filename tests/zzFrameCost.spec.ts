// TEMPORARY: measures how long desktop WebKit takes to draw a frame with the exercise picker open, with and without
// the backdrop's blur. Removed before merge.
import { expect } from '@playwright/test'
import { test } from './fixtures'
import { seedDatabase } from './seed'

test('frame cost with the picker open', async ({ page, browserName }) => {
  test.setTimeout(120_000)
  test.skip(browserName !== 'webkit', 'WebKit only')
  await seedDatabase(page)
  await page.getByRole('button', { name: 'New' }).click()
  await page.locator('dialog#new-workout-dialog a.program-link').first().click()
  await expect(page.locator('#exercises-list > .card').first()).toBeVisible()
  const measure = (label: string) =>
    page.evaluate(async (label) => {
      // Repaints a row each frame, as a hover or a focus ring does, and times 30 frames.
      const rows = [...document.querySelectorAll<HTMLElement>('#exercise-picker .exercise-choice')]
      const times: number[] = []
      let last = performance.now()
      for (let frame = 0; frame < 12; frame++) {
        rows[frame % rows.length]!.style.outline = `1px solid hsl(${frame * 12} 80% 50%)`
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(resolve)),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
        const now = performance.now()
        times.push(Math.round(now - last))
        last = now
      }
      times.sort((a, b) => a - b)
      return `${label}: median ${times[6]}ms, max ${times[11]}ms`
    }, label)
  const results: string[] = []
  for (let round = 0; round < 2; round++) {
    await page.locator('#add-exercise-card').click()
    await expect(page.locator('#exercise-picker')).toBeVisible()
    results.push(await measure(`open ${round + 1}, blur`))
    const style = await page.addStyleTag({ content: '#exercise-picker::backdrop { backdrop-filter: none !important }' })
    results.push(await measure(`open ${round + 1}, no blur`))
    await style.evaluate((element) => (element as Element).remove())
    results.push(await measure(`open ${round + 1}, blur again`))
    console.log(`FRAMECOST partial ${results.join(' | ')}`)
    await page.locator('#exercise-picker').getByRole('button', { name: 'Close dialog' }).click()
  }
  console.log(`FRAMECOST ${test.info().project.name}\n${results.join('\n')}`)
})
