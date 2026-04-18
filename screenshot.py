from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:5173/settings/')

    seed_btn = page.locator('button:has-text("Seed Database")')
    if seed_btn.is_visible():
        seed_btn.click()
        page.wait_for_timeout(500)

    page.goto('http://localhost:5173/stats/')
    page.wait_for_timeout(2000)

    page.screenshot(path='stats_screenshot.png', full_page=True)
    browser.close()
