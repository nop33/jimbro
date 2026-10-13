import { expect, test } from '@playwright/test'

test('writeRows stores nothing when a later put throws', async ({ page }) => {
  await page.goto('/settings/')
  const result = await page.evaluate(async () => {
    const { storage } = await import('/src/db/storage.ts')
    let rejected = false
    try {
      await storage.writeRows([
        { table: 'exercises', row: { id: 'keep-me', name: 'Keep' } },
        { table: 'exercises', row: { name: 'missing-id' } }
      ] as never)
    } catch {
      rejected = true
    }
    const kept = await storage.get('exercises', 'keep-me')
    return { rejected, kept: kept !== undefined }
  })
  expect(result).toEqual({ rejected: true, kept: false })
})
