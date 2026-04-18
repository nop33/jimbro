import { chromium } from 'playwright'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // Expose a function to collect browser logs
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()))
  page.on('pageerror', (err) => console.log('BROWSER ERROR:', err))

  await page.goto('http://localhost:5173/settings/')
  const seedBtn = page.locator('button', { hasText: 'Seed Database' })
  if (await seedBtn.isVisible()) {
    await seedBtn.click()
    await page.waitForTimeout(500)
  }

  await page.goto('http://localhost:5173/stats/')
  await page.waitForTimeout(2000)
  console.log('Stats HTML content:')
  console.log(await page.content())

  await browser.close()
})()
