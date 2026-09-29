import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const renderedMs = async (page: Page, path: string, waitForContent: () => Promise<unknown>): Promise<number> => {
  await installOriginMark(page)
  await page.goto(path)
  await waitForContent()
  return page.evaluate(() => {
    const origin = performance.getEntriesByName('rows-origin')[0]
    return performance.now() - origin.startTime
  })
}

const readDatabase = (page: Page) =>
  page.evaluate(async () => {
    const empty = { sets: 0, sessions: 0, latestId: undefined as string | undefined }
    const found = (await indexedDB.databases()).find((database) => database.name === 'gymbro-database')
    if (!found?.version) return empty
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gymbro-database', found.version)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const names = [...db.objectStoreNames]
    const all = (storeName: string) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction(storeName).objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>)
        request.onerror = () => reject(request.error)
      })
    const sessions = names.includes('workoutSessions') ? await all('workoutSessions') : []
    let sets = 0
    if (names.includes('sets')) {
      sets = (await all('sets')).length
    } else {
      for (const session of sessions) {
        const exercises = session.exercises
        if (!Array.isArray(exercises)) continue
        for (const exercise of exercises) {
          if (exercise && typeof exercise === 'object' && Array.isArray((exercise as { sets?: unknown }).sets)) {
            sets += (exercise as { sets: Array<unknown> }).sets.length
          }
        }
      }
    }
    const latest = sessions
      .filter(
        (session) => session.isDeleted !== true && typeof session.date === 'string' && typeof session.id === 'string'
      )
      .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0]
    db.close()
    return { sets, sessions: sessions.length, latestId: typeof latest?.id === 'string' ? latest.id : undefined }
  })

const hasSyncClient = (page: Page) =>
  page.evaluate(async () => {
    try {
      await import('/src/sync/syncClient.ts')
      return true
    } catch {
      return false
    }
  })

const ensureCredentials = (page: Page) =>
  page.evaluate(
    ({ userId, token }) => {
      const key = 'jimbro.cloudBackup'
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, JSON.stringify({ userId, token }))
    },
    { userId: process.env.PERF_CLOUD_USER ?? 'perf', token: process.env.PERF_CLOUD_TOKEN ?? 'perf' }
  )

const timedSync = (page: Page) =>
  page.evaluate(async () => {
    const { sync } = await import('/src/sync/syncClient.ts')
    const start = performance.now()
    await sync()
    return performance.now() - start
  })

const trackUploadBytes = (page: Page) => {
  let bytes = 0
  const onRequest = (request: {
    url: () => string
    method: () => string
    postData: () => string | null
    postDataBuffer: () => Buffer | null
  }) => {
    const url = request.url()
    const method = request.method()
    const isSnapshot = method === 'PUT' && url.includes('/api/snapshot')
    const isPush = method === 'POST' && url.includes('/api/push')
    if (!isSnapshot && !isPush) return
    const body = request.postDataBuffer()
    bytes += body ? body.length : Buffer.byteLength(request.postData() ?? '')
  }
  page.on('request', onRequest)
  return {
    read: () => bytes,
    stop: () => page.off('request', onRequest)
  }
}

const waitForUploadBytes = async (page: Page, read: () => number) => {
  const deadline = Date.now() + 20_000
  let last = read()
  let stableAt = Date.now()
  while (Date.now() < deadline) {
    await page.waitForTimeout(200)
    const next = read()
    if (next !== last) {
      last = next
      stableAt = Date.now()
      continue
    }
    if (next > 0 && Date.now() - stableAt >= 800) return next
  }
  return read()
}

const seedFourCopies = async (page: Page, files: Array<string>) => {
  await page.goto('/settings/')
  await page.waitForFunction(async () => {
    const found = (await indexedDB.databases()).find((database) => database.name === 'gymbro-database')
    if (!found?.version || found.version < 6) return false
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gymbro-database', found.version)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const ready = db.objectStoreNames.contains('workoutSessions')
    db.close()
    return ready
  })
  const existing = await readDatabase(page)
  if (existing.sessions >= 400) return existing
  for (const file of files) {
    const before = await readDatabase(page)
    await page.getByText('Manage local data').click()
    await page.locator('#import-input').setInputFiles(file)
    await expect
      .poll(async () => (await readDatabase(page)).sessions, { timeout: 120_000 })
      .toBeGreaterThan(before.sessions)
  }
  return readDatabase(page)
}

test('measures workouts, stats, gymtime, and set-done on four fixture copies', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('data-backup/gymbro-export-2026-01-02.json', 'utf8')) as Fixture
  const dir = mkdtempSync(join(tmpdir(), 'rows-perf-'))
  const files = copiesOf(fixture).map((copy, index) => {
    const path = join(dir, `copy-${index}.json`)
    writeFileSync(path, JSON.stringify(copy))
    return path
  })
  const seeded = await seedFourCopies(page, files)

  const workoutsMs = await renderedMs(page, '/workouts/', () => page.locator('.workout-week-list li').first().waitFor())
  const statsMs = await renderedMs(page, '/stats/', () =>
    page.waitForFunction(() => {
      const since = document.querySelector('#stat-since-date')?.textContent?.trim()
      const totalSets = document.querySelector('#stat-total-sets')?.textContent?.trim()
      return Boolean(since && totalSets && totalSets !== '0')
    })
  )
  expect(seeded.latestId).toBeTruthy()
  await ensureCredentials(page)
  const syncing = await hasSyncClient(page)
  const firstSyncMs = syncing ? await timedSync(page) : null

  const gymtimeMs = await renderedMs(page, `/gymtime/?id=${seeded.latestId}`, () =>
    page.locator('[data-exercise-id] [data-set-number]').first().waitFor({ state: 'attached' })
  )
  const card = page.locator('[data-exercise-id]').first()
  await card.locator('summary').click()
  const finished = card.getByRole('button', { name: 'Finished set' })
  if (!(await finished.isVisible())) await card.getByRole('button', { name: 'Add set' }).click()
  const uploads = trackUploadBytes(page)
  await page.evaluate(() => {
    const before = document.querySelectorAll('.isCompleted').length
    const start = performance.now()
    const measured = new Promise<number>((resolve) => {
      const finish = () => {
        if (document.querySelectorAll('.isCompleted').length <= before) return
        observer.disconnect()
        resolve(performance.now() - start)
      }
      const observer = new MutationObserver(finish)
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true })
    })
    ;(window as Window & { __setDoneMs?: Promise<number> }).__setDoneMs = measured
  })
  await finished.click()
  const setDoneMs = await page.evaluate(() => (window as Window & { __setDoneMs?: Promise<number> }).__setDoneMs)
  const uploadBytes = await waitForUploadBytes(page, uploads.read)
  uploads.stop()

  const restoreMs = syncing
    ? await page.evaluate(async () => {
        const { storage } = await import('/src/db/storage.ts')
        await storage.deleteDatabase()
        const { sync } = await import('/src/sync/syncClient.ts')
        const start = performance.now()
        await sync()
        return performance.now() - start
      })
    : null

  console.log(
    JSON.stringify({
      workoutsMs,
      statsMs,
      gymtimeMs,
      setDoneMs,
      uploadBytes,
      firstSyncMs,
      restoreMs,
      sets: seeded.sets
    })
  )
})
