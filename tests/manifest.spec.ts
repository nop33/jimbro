import { test, expect } from '@playwright/test'

test.describe('Web app manifest', () => {
  test('serves every icon and screenshot as its declared type', async ({ page, request }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    if (!href) throw new Error('The page links no manifest')
    const manifestUrl = new URL(href, page.url())
    const manifest = (await (await request.get(manifestUrl.href)).json()) as {
      icons: Array<{ src: string; type: string }>
      screenshots: Array<{ src: string; type: string }>
    }

    for (const image of [...manifest.icons, ...manifest.screenshots]) {
      const response = await request.get(new URL(image.src, manifestUrl).href)
      expect.soft(response.status(), image.src).toBe(200)
      expect.soft(response.headers()['content-type'], image.src).toBe(image.type)
    }
  })
})
