import { expect } from '@playwright/test'
import { test } from './fixtures'

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

  // Android paints its status bar and gesture bar in the theme colour, so it matches the header and the bottom nav.
  test('paints the system bars in the colour of the header and the nav', async ({ page, request }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    if (!href) throw new Error('The page links no manifest')
    const manifest = (await (await request.get(new URL(href, page.url()).href)).json()) as { theme_color: string }
    const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

    const meta = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(meta?.toLowerCase()).toBe(manifest.theme_color.toLowerCase())
    const background = (selector: string) =>
      page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(await background('.bottom-nav')).toBe(rgb(manifest.theme_color))
    expect(await background('.app-page')).toBe(rgb(manifest.theme_color))
  })
})
