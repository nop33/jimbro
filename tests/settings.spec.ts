import { test, expect } from '@playwright/test'
import { seedDatabase } from './seed'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/')
  })

  test('displays correct title and sections', async ({ page }) => {
    await expect(page).toHaveTitle(/Jimbro - Settings/)
    await expect(page.locator('h1')).toContainText('Settings')

    await page.getByText('Manage local data').click()
    await expect(page.getByRole('heading', { name: 'Data Export' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Data Import' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reset Database' })).toBeVisible()
  })

  test('reset database shows confirmation and performs reset', async ({ page }) => {
    await page.getByText('Manage local data').click()

    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Are you sure you want to reset the database?')
      await dialog.accept()
    })

    const resetBtn = page.getByRole('button', { name: 'Reset Database' })
    await resetBtn.click()

    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')
  })

  test('export database triggers download', async ({ page }) => {
    await page.getByText('Manage local data').click()
    const exportBtn = page.getByRole('button', { name: 'Export to JSON' })

    const downloadPromise = page.waitForEvent('download')
    await exportBtn.click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^jimbro-export-.*\.json$/)
  })

  test('cloud backup offers a passkey, and keeps the token form under "Use a token"', async ({ page }) => {
    const supported = await page.evaluate(async () => (await import('/src/sync/passkeys.ts')).passkeysSupported())
    await page.locator('#cloud-backup-details > summary').click()
    await expect(page.locator('#cloud-summary-status')).toHaveText('Not set up yet')
    if (supported) {
      await expect(page.getByRole('heading', { name: 'Back up your workouts' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create passkey' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible()
    } else {
      await expect(page.getByText("This browser can't use passkeys")).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeHidden()
    await expect(page.getByLabel('User ID')).toBeHidden()

    await page.getByText('Use a token').click()
    await page.getByLabel('User ID').fill('someone')
    await page.getByLabel('Token').fill('secret')
    await page.route('**/api/**', (route) => route.abort())
    await page.getByRole('button', { name: 'Save credentials' }).click()
    await expect(page.locator('.toast-message-popup')).toHaveText('Cloud backup credentials saved.')
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    // A token is no passkey, so the offer stays.
    if (supported) await expect(page.getByRole('button', { name: 'Create passkey' })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jimbro.cloudBackup') ?? 'null'))).toEqual({
      userId: 'someone',
      token: 'secret',
      method: 'token'
    })
  })

  test('a full backup says so instead of failing quietly', async ({ page }) => {
    await page.route('**/api/pull**', (route) => route.fulfill({ json: { rows: [], cursor: 0, more: false } }))
    await page.route('**/api/push', (route) => route.fulfill({ status: 413, json: { error: 'row_limit', cap: 50000 } }))
    await seedDatabase(page)
    await page.evaluate(() => {
      localStorage.setItem('jimbro.cloudBackup', JSON.stringify({ userId: 'someone', token: 'secret' }))
    })

    // The page's own sync on load runs into the full backup and says so.
    await page.goto('/settings/')
    await expect(page.locator('.toast-message-popup')).toHaveText(
      'Your cloud backup is full. New changes stay on this phone.'
    )
    await expect(page.locator('#cloud-summary-status')).toHaveText(/^Backup full · \d+ pending$/)
  })
})
