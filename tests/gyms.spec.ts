import { test, expect, type Page } from '@playwright/test'

// Seeds the programs, then one finished bench press workout per gym, a few days apart, oldest first.
const seedWorkoutsAt = async (page: Page, gyms: Array<string>) => {
  await page.goto('/workouts/')
  await page.getByRole('button', { name: 'Seed Database' }).click()
  await expect(page.locator('.workout-week')).toBeVisible()
  return page.evaluate(async (gyms) => {
    const { exercisesStore } = await import('/src/db/stores/exercisesStore.ts')
    const { programsStore } = await import('/src/db/stores/programsStore.ts')
    const { workoutSessionsStore, snapshotFromExercise } = await import('/src/db/stores/workoutSessionsStore.ts')
    await exercisesStore.load()
    await programsStore.load()
    const program = programsStore.all[0]
    const exercise = exercisesStore.find(program.exercises[0])
    if (!exercise) throw new Error('seeded program has no exercise')
    let id = ''
    for (const [index, location] of gyms.entries()) {
      let session = await workoutSessionsStore.create({
        date: `2026-09-${String(index + 10).padStart(2, '0')}`,
        programId: program.id,
        location,
        notes: '',
        exercises: [snapshotFromExercise(exercise)]
      })
      session = await workoutSessionsStore.addSet(session, exercise.id, { preset: 'lifting', reps: 5, weight: 40 })
      id = session.id
    }
    return { programId: program.id, sessionId: id }
  }, gyms)
}

test('suggests the gyms already used, and clears the field to show them all', async ({ page }) => {
  const { programId } = await seedWorkoutsAt(page, ['Athens', 'Holmes Place Syntagma'])

  await page.goto(`/gymtime/?programId=${programId}`)
  const gym = page.locator('input[name="location"]')
  await expect(gym).toHaveValue('Holmes Place Syntagma')
  await expect(page.locator('#gym-options option')).toHaveText(['Holmes Place Syntagma', 'Athens'])

  await page.getByRole('button', { name: 'Clear gym' }).click()
  await expect(gym).toHaveValue('')
  await expect(gym).toBeFocused()
  await expect(page.getByRole('button', { name: 'Clear gym' })).toBeHidden()
})

test('renames a gym on every workout, merging it into another', async ({ page }) => {
  await seedWorkoutsAt(page, ['Athens', 'Holmes Place Syntagma', 'Athens'])
  await page.goto('/settings/')
  await page.locator('#gyms-details summary').click()

  const from = page.locator('#rename-gym-from')
  await expect(from.locator('option')).toHaveText(['Athens (2 workouts)', 'Holmes Place Syntagma (1 workout)'])
  await from.selectOption('Athens')
  await page.getByLabel('New name').fill('Holmes Place Syntagma')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Rename' }).click()

  await expect(page.locator('.toast-message-popup')).toContainText('Renamed on 2 workouts')
  await expect(from.locator('option')).toHaveText(['Holmes Place Syntagma (3 workouts)'])
})

test('the history chart keys the gyms under it and toggles a metric from its header', async ({ page }) => {
  const { sessionId } = await seedWorkoutsAt(page, ['Holmes Place Syntagma', 'Hotel gym', 'Holmes Place Syntagma'])
  await page.goto(`/gymtime/?id=${sessionId}`)
  const card = page.locator('details.exercise-details').first()
  await card.locator('summary').click()
  await card.locator('.view-history-btn').click()

  await expect(page.locator('#exercise-history-gyms li')).toHaveText(['Unshaded: Holmes Place Syntagma', 'Hotel gym'])

  // The header's metric buttons hide and show their line.
  const volume = page.getByRole('button', { name: 'Total volume' })
  await volume.click()
  await expect(volume).toHaveAttribute('aria-pressed', 'false')
  await volume.click()
  await expect(volume).toHaveAttribute('aria-pressed', 'true')
})
