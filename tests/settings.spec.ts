import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/');
  });

  test('displays correct title and sections', async ({ page }) => {
    await expect(page).toHaveTitle(/Jimbro - Settings/);
    await expect(page.locator('h1')).toContainText('Settings');

    await expect(page.getByRole('heading', { name: 'Data Export' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data Import' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reset Database' })).toBeVisible();
  });

  test('reset database shows confirmation and performs reset', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to reset the database?');
      await dialog.accept();
    });

    const resetBtn = page.getByRole('button', { name: 'Reset Database' });
    await resetBtn.click();

    await expect(page.locator('.toast-message-popup')).toContainText('Database reset');
  });

  test('export database triggers download', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: 'Export to JSON' });

    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^jimbro-export-.*\.json$/);
  });
});
