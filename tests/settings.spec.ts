import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { browserHasPasskeys } from './browserPasskeys'
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

  test('reset database asks first, then empties the database', async ({ page }) => {
    await seedDatabase(page)
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()

    const asked: string[] = []
    page.on('dialog', async (dialog) => {
      asked.push(dialog.message())
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')
    expect(asked).toEqual([expect.stringContaining('Are you sure you want to reset the database?')])

    // The workouts page is back to its first-run state.
    await page.goto('/workouts/')
    await expect(page.locator('#intro')).toHaveText(
      "Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?"
    )
  })

  test('exports the database as a version 4 JSON file', async ({ page }) => {
    await seedDatabase(page)
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export to JSON' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^jimbro-export-.*\.json$/)

    const file = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      version: number
      stores: { exercises: unknown[]; programs: Array<{ name: string }>; workoutSessions: unknown[] }
    }
    expect(file.version).toBe(4)
    expect(file.stores.exercises).toHaveLength(21)
    expect(file.stores.programs.map((program) => program.name)).toEqual(['Push day', 'Pull day', 'Legs day'])
    expect(file.stores.workoutSessions).toEqual([])
  })

  test('cloud backup offers a passkey, and keeps the token form under "Use a token"', async ({ page }) => {
    const supported = await browserHasPasskeys(page)
    await page.locator('#cloud-backup-details > summary').click()
    await expect(page.locator('#cloud-summary-status')).toHaveText('Not set up yet')
    if (supported) {
      await expect(page.getByRole('heading', { name: 'Back up your workouts' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create passkey' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible()
    } else {
      await expect(page.getByText("This browser can't use passkeys")).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(0)
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
    await expect(page.getByRole('button', { name: 'Create passkey' })).toHaveCount(supported ? 1 : 0)

    // The page loads again set up with the token, and fills the token form back in.
    await page.reload()
    await page.locator('#cloud-backup-details > summary').click()
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await page.getByText('Use a token').click()
    await expect(page.getByLabel('User ID')).toHaveValue('someone')
  })

  test('a full backup says so instead of failing quietly', async ({ page }) => {
    await page.route('**/api/pull**', (route) => route.fulfill({ json: { rows: [], cursor: 0, more: false } }))
    await page.route('**/api/push', (route) => route.fulfill({ status: 413, json: { error: 'row_limit', cap: 50000 } }))
    await seedDatabase(page)
    await page.goto('/settings/')
    await page.locator('#cloud-backup-details > summary').click()
    await page.getByText('Use a token').click()
    await page.getByLabel('User ID').fill('someone')
    await page.getByLabel('Token').fill('secret')
    await page.getByRole('button', { name: 'Save credentials' }).click()

    await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()

    // The page's own sync on load runs into the full backup and says so. The 21 sample exercises and 3 programs stay
    // queued.
    await page.reload()
    await expect(page.locator('.toast-message-popup')).toHaveText(
      'Your cloud backup is full. New changes stay on this phone.'
    )
    await expect(page.locator('#cloud-summary-status')).toHaveText('Backup full · 24 pending')
  })
})
