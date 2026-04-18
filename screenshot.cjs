const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.goto('http://localhost:5173/settings/')
  const seedBtn = page.locator('button', { hasText: 'Seed Database' })
  if (await seedBtn.isVisible()) {
    await seedBtn.click()
    await page.waitForTimeout(500)
  }

  await page.goto('http://localhost:5173/stats/')
  await page.waitForTimeout(2000)

  await page.screenshot({ path: 'stats_screenshot.png', fullPage: true })

  await browser.close()
})()
