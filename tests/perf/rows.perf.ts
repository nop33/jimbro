import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const COPIES = 4

interface FixtureSession {
  date: string
  programId: string
  exercises: Array<{ exerciseId: string; sets: Array<unknown> }>
  location: string
  status: string
}

interface Fixture {
  version: number
  exportDate: string
  stores: {
    exercises: Array<Record<string, unknown>>
    programs: Array<Record<string, unknown>>
    workoutSessions: Array<FixtureSession>
  }
}

const shiftDate = (date: string, years: number): string => {
  const [year, month, day] = date.split('-')
  return `${Number(year) - years}-${month}-${day}`
}

const copiesOf = (fixture: Fixture): Array<Fixture> =>
  Array.from({ length: COPIES }, (_, index) => ({
    version: 1,
    exportDate: fixture.exportDate,
    stores: {
      exercises: index === 0 ? fixture.stores.exercises : [],
      programs: index === 0 ? fixture.stores.programs : [],
      workoutSessions: fixture.stores.workoutSessions.map((session) => ({
        ...session,
        date: shiftDate(session.date, index)
      }))
    }
  }))

const installOriginMark = async (page: Page) => {
  await page.addInitScript(() => {
    performance.mark('rows-origin')
  })
}

const renderedMs = async (page: Page, path: string, ready: string): Promise<number> => {
  await installOriginMark(page)
  await page.goto(path)
  await page.locator(ready).first().waitFor()
  return page.evaluate(() => {
    const origin = performance.getEntriesByName('rows-origin')[0]
    return performance.now() - origin.startTime
  })
}

const seedFourCopies = async (page: Page, copies: Array<Fixture>) => {
  await page.goto('/workouts/')
  const alreadySeeded = await page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    return (await workoutSessionsStore.countWorkoutSessions()) >= 400
  })
  if (alreadySeeded) return

  for (const copy of copies) {
    await page.evaluate(async (payload) => {
      const { importIndexedDbFromJson } = await import('/src/db/import.ts')
      const file = new File([JSON.stringify(payload)], 'copy.json', { type: 'application/json' })
      await importIndexedDbFromJson(file)
    }, copy)
  }
}

test('measures workouts, stats, gymtime, and set-done on four fixture copies', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('data-backup/gymbro-export-2026-01-02.json', 'utf8')) as Fixture
  await seedFourCopies(page, copiesOf(fixture))

  const workoutsMs = await renderedMs(page, '/workouts/', '.workout-week')
  const statsMs = await renderedMs(page, '/stats/', '#stat-completed-sessions')
  const latestId = await page.evaluate(async () => {
    const { workoutSessionsStore } = await import('/src/db/stores/workoutSessionsStore.ts')
    const sessions = await workoutSessionsStore.getAllWorkoutSessions()
    sessions.sort((left, right) => right.date.localeCompare(left.date))
    return sessions[0]?.id
  })
  expect(latestId).toBeTruthy()

  const gymtimeMs = await renderedMs(page, `/gymtime/?id=${latestId}`, '[data-exercise-id]')
  const card = page.locator('[data-exercise-id]').first()
  const finished = card.getByRole('button', { name: 'Finished set' })
  if (!(await finished.isVisible())) {
    await card.getByRole('button', { name: 'Add set' }).click()
  }
  const completedBefore = await page.locator('.isCompleted').count()
  const started = await page.evaluate(() => performance.now())
  await finished.click()
  await expect(page.locator('.isCompleted')).toHaveCount(completedBefore + 1)
  const setDoneMs = await page.evaluate((start) => performance.now() - start, started)

  console.log(
    JSON.stringify({
      workoutsMs,
      statsMs,
      gymtimeMs,
      setDoneMs,
      sets: 2581 * COPIES
    })
  )
})
