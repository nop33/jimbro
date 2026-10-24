import { test, expect } from '@playwright/test'
import { seedDatabase } from './seed'

for (const direction of ['minimize', 'maximize'] as const) {
  test(`probe ${direction} frames`, async ({ page }) => {
    await seedDatabase(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
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
    if (direction === 'maximize') {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await breakTimer.getByRole('button', { name: 'Minimize' }).click()
      await expect(breakTimer).toHaveClass(/dialog-minimized/)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
    const paused = page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const nextFrame = () => new Promise((done) => requestAnimationFrame(done))
          void (async () => {
            for (let i = 0; i < 120; i++) {
              const vt = document.getAnimations().filter((a) => String((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith('::view-transition'))
              if (vt.length) {
                vt.forEach((a) => a.pause())
                resolve(vt.map((a) => `${(a.effect as KeyframeEffect).pseudoElement} ${(a as CSSAnimation).animationName ?? ''}`).join('\n'))
                return
              }
              await nextFrame()
            }
            resolve('none')
          })()
        })
    )
    if (direction === 'minimize') await breakTimer.getByRole('button', { name: 'Minimize' }).click()
    else await breakTimer.click()
    console.log(`PROBE ${test.info().project.name} ${direction} animations:\n${await paused}`)
    for (const t of [0, 75, 150, 225]) {
      await page.evaluate((time) => {
        document.getAnimations().forEach((a) => {
          if (String((a.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith('::view-transition')) a.currentTime = time
        })
      }, t)
      const shot = await page.screenshot({ type: 'jpeg', quality: 40, scale: 'css' })
      const b64 = shot.toString('base64')
      console.log(`PROBEIMG ${test.info().project.name} ${direction} ${t} BEGIN`)
      for (let i = 0; i < b64.length; i += 4000) console.log(`PROBEDATA ${b64.slice(i, i + 4000)}`)
      console.log(`PROBEIMG END`)
    }
  })
}
