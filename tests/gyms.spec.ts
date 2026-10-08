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

test('suggests the gyms already used and fills in the nearest gym', async ({ page, context }) => {
  const { programId } = await seedWorkoutsAt(page, ['Athens', 'Holmes Place Syntagma'])
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 37.9755, longitude: 23.7348 })
  await context.route('https://overpass-api.de/**', (route) =>
    route.fulfill({
      json: {
        elements: [
          { type: 'way', center: { lat: 37.978, lon: 23.737 }, tags: { name: 'Far Gym' } },
          { type: 'node', lat: 37.9756, lon: 23.7349, tags: { name: 'Near Gym' } },
          { type: 'node', lat: 37.9757, lon: 23.7349, tags: {} }
        ]
      }
    })
  )

  await page.goto(`/gymtime/?programId=${programId}`)
  const gym = page.locator('input[name="location"]')
  await expect(gym).toHaveValue('Holmes Place Syntagma')
  await expect(page.locator('#gym-options option')).toHaveText(['Holmes Place Syntagma', 'Athens'])

  await page.getByRole('button', { name: 'Clear gym' }).click()
  await expect(gym).toHaveValue('')
  await expect(gym).toBeFocused()
  await expect(page.getByRole('button', { name: 'Clear gym' })).toBeHidden()

  await page.getByRole('button', { name: 'Find gyms near me' }).click()
  await expect(gym).toHaveValue('Near Gym')
  await expect(page.locator('#gym-options option')).toHaveText([
    'Near Gym',
    'Far Gym',
    'Holmes Place Syntagma',
    'Athens'
  ])
})

test('falls back to the city when no gym is nearby', async ({ page, context }) => {
  const { programId } = await seedWorkoutsAt(page, [])
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 37.9755, longitude: 23.7348 })
  await context.route('https://overpass-api.de/**', (route) => route.fulfill({ json: { elements: [] } }))
  await context.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ json: { address: { city: 'Athens' } } })
  )

  await page.goto(`/gymtime/?programId=${programId}`)
  await page.getByRole('button', { name: 'Find gyms near me' }).click()
  await expect(page.locator('input[name="location"]')).toHaveValue('Athens')
  await expect(page.locator('.toast-message-popup')).toContainText('No gym found nearby')
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

test('the history chart names the usual gym and keys the others apart from the metrics', async ({ page }) => {
  const { sessionId } = await seedWorkoutsAt(page, ['Holmes Place Syntagma', 'Hotel gym', 'Holmes Place Syntagma'])
  await page.goto(`/gymtime/?id=${sessionId}`)
  const card = page.locator('details.exercise-details').first()
  await card.locator('summary').click()
  await card.locator('.view-history-btn').click()

  await expect(page.locator('#exercise-history-gyms li')).toHaveText(['Unshaded: Holmes Place Syntagma', 'Hotel gym'])
})
