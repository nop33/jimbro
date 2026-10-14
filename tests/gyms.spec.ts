import { test, expect, type Page } from '@playwright/test'
import { seedDatabase } from './seed'

// Seeds the programs, then one bench press workout per gym, a few days apart, oldest first, with the sets given for
// each gym, one by default.
const seedWorkoutsAt = async (page: Page, gyms: Array<string>, sets: Array<number> = []) => {
  await seedDatabase(page)
  return page.evaluate(
    async ({ gyms, sets }) => {
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
        for (let set = 0; set < (sets[index] ?? 1); set++) {
          session = await workoutSessionsStore.addSet(session, exercise.id, { preset: 'lifting', reps: 5, weight: 40 })
        }
        id = session.id
      }
      return { programId: program.id, sessionId: id }
    },
    { gyms, sets }
  )
}

test('suggests the gyms already used, and clears the field to show them all', async ({ page }) => {
  const { programId } = await seedWorkoutsAt(page, ['Athens', 'Holmes Place Syntagma'])

  await page.goto(`/gymtime/?programId=${programId}`)
  // The summary line shows the day and gym, and opens the fields.
  await expect(page.locator('#workout-gym-label')).toHaveText('Holmes Place Syntagma')
  await page.locator('#workout-details > summary').click()
  const gym = page.locator('input[name="location"]')
  await expect(gym).toHaveValue('Holmes Place Syntagma')
  await expect(page.locator('#gym-options option')).toHaveText(['Holmes Place Syntagma', 'Athens'])

  await page.getByRole('button', { name: 'Clear gym' }).click()
  await expect(gym).toHaveValue('')
  await expect(gym).toBeFocused()
  await expect(page.getByRole('button', { name: 'Clear gym' })).toBeHidden()
})

test('the cards before the start show the set slots the start stores for the gym in the form', async ({ page }) => {
  // Bench press asks for 4 sets. Last time at the hotel gym had 6.
  const { programId } = await seedWorkoutsAt(page, ['Hotel gym', 'Athens'], [6, 1])

  await page.goto(`/gymtime/?programId=${programId}`)
  await page.locator('#workout-details > summary').click()
  const gym = page.locator('input[name="location"]')
  await expect(gym).toHaveValue('Athens')
  const slots = page.locator('#exercises-list > .card').first().locator('.completed-sets > .isPending')
  await expect(slots).toHaveCount(4)

  await gym.fill('Hotel gym')
  await gym.blur()
  await expect(slots).toHaveCount(6)
  await expect(page.locator('#workout-gym-label')).toHaveText('Hotel gym')

  // Logging the first set starts the workout with the targets the cards showed.
  const card = page.locator('#exercises-list > .card').first()
  await card.locator('.exercise-details > summary').click()
  await card.getByRole('button', { name: 'Finished set' }).click()
  await expect(page.locator('.toast-message-popup')).toContainText('Workout started')
  await expect(page).toHaveURL(/\?id=/)
  await expect(slots).toHaveCount(5)
  await expect(card.locator('.completed-sets > .isCompleted')).toHaveCount(1)
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
  // Without animation the chart repaints at once, so its pixels show what each toggle drew.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/gymtime/?id=${sessionId}`)
  const card = page.locator('details.exercise-details').first()
  await card.locator('summary').click()
  await card.locator('.view-history-btn').click()

  await expect(page.locator('#exercise-history-gyms li')).toHaveText(['Unshaded: Holmes Place Syntagma', 'Hotel gym'])

  // The header's metric buttons hide and show their line.
  // What the canvas shows once it has its final size and stops changing. WebKit can draw a frame or two at the old
  // size before the chart fits its dialog, so the drawing must also have the shape the canvas has on screen.
  const pixels = () =>
    page.locator('#exercise-history-chart').evaluate(async (element) => {
      const canvas = element as HTMLCanvasElement
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      let last = ''
      for (;;) {
        await nextFrame()
        // The dialog shows the chart in landscape on every screen, rotating it on a phone held upright, and Mobile Safari
        // on Linux can draw it upright first. The client size leaves out the rotation, like the chart's own sizing.
        const fitted =
          canvas.hasAttribute('style') &&
          canvas.width > canvas.height &&
          Math.abs(canvas.width / canvas.height - canvas.clientWidth / canvas.clientHeight) < 0.02
        const now = fitted ? `${canvas.width}x${canvas.height} ${canvas.toDataURL()}` : ''
        if (now !== '' && now === last) return now
        last = now
      }
    })
  const withVolume = await pixels()
  const volume = page.getByRole('button', { name: 'Total volume' })
  await volume.click()
  await expect(volume).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(pixels).not.toBe(withVolume)
  await volume.click()
  await expect(volume).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(pixels).toBe(withVolume)
})

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`the history chart animates its lines only without reduced motion (${reducedMotion})`, async ({
    page
  }, testInfo) => {
    // Reading the pixels is so slow on a Mobile Safari canvas that the animation is over before it sees two frames at
    // the final size, so only the still chart can be checked there.
    test.skip(reducedMotion === 'no-preference' && testInfo.project.name === 'Mobile Safari', 'pixel reads too slow')
    const { sessionId } = await seedWorkoutsAt(page, ['Athens', 'Athens', 'Athens'], [1, 2, 3])
    await page.emulateMedia({ reducedMotion })
    await page.goto(`/gymtime/?id=${sessionId}`)
    const card = page.locator('details.exercise-details').first()
    await card.locator('summary').click()
    await card.locator('.view-history-btn').click()
    await expect(page.locator('#exercise-history-dialog')).toBeVisible()

    // An animated chart paints its lines a little further on every frame for a second. A chart that does not animate
    // paints its final lines on the first frame at its final size, so every frame at that size matches the last one.
    // Frames at another size come before the chart fits its dialog, and WebKit can resize it late. Reading the pixels is
    // slow on a Mobile Safari canvas, so it may see only a few frames at the final size.
    const frames = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('#exercise-history-chart')
      if (!canvas) throw new Error('no chart canvas')
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      while (!canvas.hasAttribute('style')) await nextFrame()
      const seen: Array<{ size: string; pixels: string }> = []
      const start = performance.now()
      while (performance.now() - start < 2000) {
        await nextFrame()
        seen.push({ size: `${canvas.width}x${canvas.height}`, pixels: canvas.toDataURL() })
      }
      return seen
    })
    const last = frames[frames.length - 1]
    const atFinalSize = frames.filter((frame) => frame.size === last.size)
    expect(atFinalSize.length).toBeGreaterThan(1)
    const changing = atFinalSize.filter((frame) => frame.pixels !== last.pixels)
    if (reducedMotion === 'reduce') expect(changing).toHaveLength(0)
    else expect(changing).not.toHaveLength(0)
  })
}
