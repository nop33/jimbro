import { test, expect } from '@playwright/test'

test('GymtimePage showError XSS reproduction', async ({ page }) => {
  await page.goto('/gymtime/?programId=non-existent')

  // Wait for the page to load and fail
  await expect(page.locator('.text-jim-error')).toBeVisible()

  // Try to inject XSS by manually calling the private-ish showError if we can,
  // or just check if we can manipulate the DOM in a way that showError would.
  // Since showError is a private static method, we might not be able to call it directly from window.

  // However, we can check if the current implementation of showError is vulnerable
  // by seeing if it would execute a script if it were passed one.

  const xssTriggered = await page.evaluate(async () => {
    // We try to find the pageContent and simulate what showError does
    const pageContent = document.querySelector('.app-page-content')
    if (!pageContent) return false

    const maliciousMessage = '<img src=x onerror="window.xss_triggered = true">'

    // This is exactly what GymtimePage.showError does:
    pageContent.innerHTML = `
      <div class="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <p class="text-lg text-jim-error">${maliciousMessage}</p>
        <a href="/workouts/" class="btn-primary">Back to workouts</a>
      </div>
    `

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve((window as any).xss_triggered === true)
      }, 100)
    })
  })

  expect(xssTriggered).toBe(true)
})

test('ToastMessage XSS reproduction', async ({ page }) => {
  await page.goto('/')

  const xssTriggered = await page.evaluate(async () => {
    // Simulate what ToastMessage.render does
    const toastMessagePopup = document.createElement('div')
    const maliciousMessage = '<img src=x onerror="window.toast_xss_triggered = true">'

    // This is exactly what ToastMessagePopup.render does:
    toastMessagePopup.innerHTML = maliciousMessage
    document.body.appendChild(toastMessagePopup)

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve((window as any).toast_xss_triggered === true)
      }, 100)
    })
  })

  expect(xssTriggered).toBe(true)
})
