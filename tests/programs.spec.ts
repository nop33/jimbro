import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'

const createExercise = async (page: Page, name: string, muscle: string) => {
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: muscle })
  await page.getByLabel('Default sets').fill('4')
  await page.getByLabel('Default reps').fill('8')
  await page.getByRole('button', { name: 'Save' }).click()
  // The card shows before the exercise is stored, so wait for the stored row before going on.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { storage } = await import('/src/db/storage.ts')
        return (await storage.getAll<{ name: string }>('exercises')).map(({ name }) => name)
      })
    )
    .toContain(name)
}

const rowNames = (page: Page) => page.locator('#program-exercises .program-row-name')

// Creates a program through New and the exercise picker it opens on, and leaves its page on screen.
const createProgram = async (page: Page, name: string, exercises: Array<string>) => {
  await page.goto('/programs/')
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  const sheet = page.locator('#exercise-picker')
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/\/programs\/program\/\?id=[^&]+$/)
  for (const exercise of exercises) await sheet.getByLabel(exercise).check()
  if (exercises.length > 0) await sheet.getByRole('button', { name: /^Add \d+ exercises?$/ }).click()
  else await sheet.getByRole('button', { name: 'Close dialog' }).click()
  await expect(sheet).toBeHidden()
  await expect(rowNames(page)).toHaveText(exercises)
}

test.describe('Programs Page', () => {
  test.beforeEach(async ({ page }) => {
    // Each test's browser context starts with an empty database. Create the exercises to add to the program.
    await page.goto('/exercises/')
    await createExercise(page, 'Squat', 'Quads')
    await createExercise(page, 'Bench', 'Chest')
  })

  test('New asks for a name, then opens the program on the exercise picker', async ({ page }) => {
    await page.goto('/programs/')
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('#new-program-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Close dialog' }).click()
    await expect(dialog).toBeHidden()

    await createProgram(page, 'Leg Day', ['Squat', 'Bench'])
    await expect(page.getByRole('heading', { name: 'Leg Day', level: 1 })).toBeVisible()
    await expect(page.locator('#program-totals')).toHaveText('2 exercises · 8 sets')
    await expect(page.getByRole('link', { name: 'Start this program' })).toHaveAttribute('href', /programId=/)

    // The list shows the program as one card that opens its page.
    await page.goto('/programs/')
    const card = page.locator('#programs-grid .program-card', { hasText: 'Leg Day' })
    await expect(card).toContainText('2 exercises · 8 sets')
    await expect(card.locator('.program-muscles span')).toHaveText(['Quads', 'Chest'])
    await card.click()
    await expect(rowNames(page)).toHaveText(['Squat', 'Bench'])
  })

  test('the picker shows what the program holds, filters by name and adds in the order checked', async ({ page }) => {
    await page.goto('/exercises/')
    await createExercise(page, 'Lunge', 'Quads')
    await createProgram(page, 'Legs', ['Squat'])

    await page.getByRole('button', { name: 'Add exercises' }).click()
    const sheet = page.locator('#exercise-picker')
    await expect(sheet.getByLabel('Squat')).toBeChecked()
    await expect(sheet.getByLabel('Squat')).toBeDisabled()
    await expect(sheet.getByRole('button', { name: 'Add exercises' })).toBeDisabled()

    await sheet.getByLabel('Search exercises').fill('lun')
    await expect(sheet.locator('.exercise-choice-name:visible')).toHaveText(['Lunge'])
    await expect(sheet.locator('.exercise-choice-group-title:visible')).toHaveText(['Quads'])
    await sheet.getByLabel('Search exercises').fill('zzz')
    await expect(sheet.getByText('No exercise matches.')).toBeVisible()
    await sheet.getByLabel('Search exercises').fill('')

    await sheet.getByLabel('Lunge').check()
    await sheet.getByLabel('Bench').check()
    await sheet.getByRole('button', { name: 'Add 2 exercises' }).click()
    await expect(rowNames(page)).toHaveText(['Squat', 'Lunge', 'Bench'])
  })

  test('the picker files rehab and cardio under their own chips, which filter it with the search', async ({ page }) => {
    await page.goto('/exercises/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Band rotation')
    await page.getByLabel('Kind').selectOption('rehab')
    await page.getByLabel('Muscle group', { exact: true }).selectOption({ label: 'Chest' })
    await page.getByLabel('Default sets').fill('3')
    await page.getByLabel('Default reps').fill('15')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Exercise saved')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Name').fill('Treadmill walk')
    await page.getByLabel('Kind').selectOption('cardio')
    await page.getByLabel('Default sets').fill('1')
    await page.getByRole('button', { name: 'Save' }).click()
    // The card shows before the exercise is stored, so wait for the stored row before leaving the page.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { storage } = await import('/src/db/storage.ts')
          return (await storage.getAll<{ name: string }>('exercises')).length
        })
      )
      .toBe(4)
    await createProgram(page, 'Mixed', [])

    await page.getByRole('button', { name: 'Add exercises' }).click()
    const sheet = page.locator('#exercise-picker')
    const filter = sheet.getByRole('radiogroup', { name: 'Show' })
    await expect(filter.getByRole('radio')).toHaveCount(5)
    await expect(filter.getByRole('radio', { name: 'All' })).toBeChecked()
    await expect(sheet.locator('.exercise-choice-group-title:visible')).toHaveText([
      'Chest',
      'Quads',
      'Rehab',
      'Cardio'
    ])
    // A rehab row names the muscle it works.
    await expect(sheet.locator('.exercise-choice', { hasText: 'Band rotation' })).toContainText('Chest')

    await filter.getByText('Cardio', { exact: true }).click()
    await expect(sheet.locator('.exercise-choice-name:visible')).toHaveText(['Treadmill walk'])
    // The chip's radio takes the focus without scrolling the sheet off its header.
    await expect(sheet.getByRole('heading', { name: 'Add exercises' })).toBeInViewport()
    await expect(sheet.getByLabel('Treadmill walk')).toBeInViewport()
    await filter.getByText('Rehab', { exact: true }).click()
    await expect(sheet.locator('.exercise-choice-name:visible')).toHaveText(['Band rotation'])
    await sheet.getByLabel('Search exercises').fill('squat')
    await expect(sheet.getByText('No exercise matches.')).toBeVisible()
    await filter.getByText('All', { exact: true }).click()
    await expect(sheet.locator('.exercise-choice-name:visible')).toHaveText(['Squat'])

    await sheet.getByLabel('Search exercises').fill('')
    await sheet.getByLabel('Treadmill walk').check()
    await sheet.getByRole('button', { name: 'Add 1 exercise' }).click()
    await expect(rowNames(page)).toHaveText(['Treadmill walk'])
  })

  test('reorders by dragging a handle or with its arrow keys, and removes, saving each change', async ({ page }) => {
    await page.goto('/exercises/')
    await createExercise(page, 'Lunge', 'Quads')
    await createProgram(page, 'Legs', ['Squat', 'Bench', 'Lunge'])

    // Drag Lunge's handle above Squat.
    const handle = page.getByRole('button', { name: 'Reorder Lunge' })
    const from = await handle.boundingBox()
    const to = await page.locator('#program-exercises .program-row').first().boundingBox()
    if (!from || !to) throw new Error('The rows are not on screen')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 })
    await page.mouse.up()
    await expect(rowNames(page)).toHaveText(['Lunge', 'Squat', 'Bench'])

    await page.getByRole('button', { name: 'Reorder Squat' }).press('ArrowDown')
    await expect(rowNames(page)).toHaveText(['Lunge', 'Bench', 'Squat'])
    await expect(page.getByRole('button', { name: 'Reorder Squat' })).toBeFocused()

    // Removing asks first, and No keeps the exercise.
    page.once('dialog', (dialog) => void dialog.dismiss())
    await page.getByRole('button', { name: 'Remove Bench' }).click()
    await expect(rowNames(page)).toHaveText(['Lunge', 'Bench', 'Squat'])

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Remove Bench from this program?')
      void dialog.accept()
    })
    await page.getByRole('button', { name: 'Remove Bench' }).click()
    await expect(rowNames(page)).toHaveText(['Lunge', 'Squat'])

    await page.reload()
    await expect(rowNames(page)).toHaveText(['Lunge', 'Squat'])
  })

  test('renames and deletes a program', async ({ page }) => {
    await createProgram(page, 'Leg Day', ['Squat'])

    await page.getByRole('button', { name: 'Rename' }).click()
    const rename = page.locator('#rename-program-dialog')
    await expect(rename.getByLabel('Name')).toBeFocused()
    await rename.getByLabel('Name').fill('Mega Leg Day')
    await rename.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Mega Leg Day', level: 1 })).toBeVisible()

    page.once('dialog', (confirmDialog) => void confirmDialog.accept())
    await page.getByRole('button', { name: 'Delete program' }).click()
    await expect(page).toHaveURL(/\/programs\/$/)
    await expect(page.locator('#programs-grid .program-card')).toHaveCount(0)
  })

  test('says so when the program is gone', async ({ page }) => {
    await page.goto('/programs/program/?id=missing')
    await expect(page.getByText('This program was deleted.')).toBeVisible()
    await expect(page.locator('#program-content')).toBeHidden()
  })

  test('shows an exercise name as text in the exercise picker', async ({ page }) => {
    // The picker once built its options from an HTML string, so this name ran its onerror handler.
    const name = '<img src=x onerror="window.__injected = true">Row'
    await page.goto('/exercises/')
    await createExercise(page, name, 'Back')

    await createProgram(page, 'Pull', [])
    await page.getByRole('button', { name: 'Add exercises' }).click()
    const sheet = page.locator('#exercise-picker')
    await expect(sheet.locator('.exercise-choice-name', { hasText: 'Row' })).toHaveText(name)
    await expect(sheet.locator('img')).toHaveCount(0)
    expect(await page.evaluate(() => Reflect.get(window, '__injected'))).toBeUndefined()
  })
})
