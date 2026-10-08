import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { rowsFromExport } from '../src/sync/rows'
import type { ExportShape, Row } from '../src/db/types'
import { API_BASE, claimUser, type WorkerUser } from './localWorker'

const fixturePath = path.join(import.meta.dirname, '..', 'worker', 'test', 'fixtures', 'latest-v4.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExportShape
// The most rows the worker accepts in one push (ROW_LIMIT in worker/src/rows.ts).
const ROW_LIMIT = 1000

interface SetExecution {
  preset: 'lifting'
  reps: number
  weight: number
}

interface SetBody {
  id: string
  sessionId: string
  exerciseId: string
  position: number
  set: SetExecution
  isDeleted: boolean
  updatedAt: string
}

interface WireRow {
  table: string
  row: { id: string } & Record<string, unknown>
  rev: number
}

interface ExportFile {
  version: number
  exportDate: string
  stores: {
    exercises: Array<{ id: string }>
    programs: Array<{ id: string }>
    workoutSessions: Array<{ id: string; exercises: Array<{ sets: unknown[] }> }>
  }
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

const pull = async (token: string, cursor: number) => {
  const response = await fetch(`${API_BASE}/api/pull?cursor=${cursor}&limit=1000`, { headers: authHeaders(token) })
  if (!response.ok) throw new Error(`pull ${response.status} ${await response.text()}`)
  return (await response.json()) as { rows: WireRow[]; cursor: number; more: boolean }
}

const pullAll = async (token: string) => {
  const rows: WireRow[] = []
  let cursor = 0
  for (;;) {
    const page = await pull(token, cursor)
    rows.push(...page.rows)
    if (!page.more || page.rows.length === 0) return rows
    cursor = page.cursor
  }
}

const exportStores = async (token: string) => {
  const response = await fetch(`${API_BASE}/api/export`, { headers: authHeaders(token) })
  if (!response.ok) throw new Error(`export ${response.status} ${await response.text()}`)
  return sortExport((await response.json()) as ExportFile)
}

const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

const sortExport = (data: ExportFile) => ({
  version: data.version,
  stores: {
    exercises: byId(data.stores.exercises),
    programs: byId(data.stores.programs),
    workoutSessions: byId(data.stores.workoutSessions)
  }
})

const pushRows = async (token: string, rows: unknown[]) => {
  const response = await fetch(`${API_BASE}/api/push`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  })
  if (!response.ok) throw new Error(`push ${response.status} ${await response.text()}`)
}

// Puts the fixture on the server the way clients do, in pushes of at most ROW_LIMIT rows.
const seedFixture = async (user: WorkerUser) => {
  const rowSet = rowsFromExport(fixture)
  const rows: Row[] = [
    ...rowSet.exercises.map((row) => ({ table: 'exercises' as const, row })),
    ...rowSet.programs.map((row) => ({ table: 'programs' as const, row })),
    ...rowSet.sessions.map((row) => ({ table: 'sessions' as const, row })),
    ...rowSet.sets.map((row) => ({ table: 'sets' as const, row }))
  ]
  for (let start = 0; start < rows.length; start += ROW_LIMIT) {
    await pushRows(user.token, rows.slice(start, start + ROW_LIMIT))
  }
}

const signIn = async (page: Page, user: WorkerUser) => {
  await page.goto('/settings/')
  const base = await page.evaluate(async () => {
    const backup = await import('/src/db/cloudBackup.ts')
    return backup.API_BASE as string
  })
  expect(base, 'The app must talk to the local worker. Stop any dev server of your own so Playwright starts one.').toBe(
    API_BASE
  )
  await page.evaluate((credentials) => {
    localStorage.setItem('jimbro.cloudBackup', JSON.stringify(credentials))
  }, user)
}

const runSync = (page: Page) =>
  page.evaluate(async () => {
    const client = await import('/src/sync/syncClient.ts')
    await client.sync()
  })

const outbox = (page: Page) =>
  page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    return db.storage.getAll<{ id: string }>('outbox')
  })

const cursorOf = (page: Page) =>
  page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    const { getMeta } = await import('/src/sync/queue.ts')
    return getMeta(db.storage, 'cursor')
  })

const localStores = (page: Page) =>
  page.evaluate(async () => {
    const exported = await import('/src/db/export.ts')
    return exported.buildExportData()
  })

const liftingSet = async (token: string): Promise<SetBody> => {
  const rows = await pullAll(token)
  const found = rows.find(
    (row) => row.table === 'sets' && (row.row.set as SetExecution | undefined)?.preset === 'lifting'
  )
  if (!found) throw new Error('fixture has no lifting set')
  return found.row as unknown as SetBody
}

const writeSet = (page: Page, set: SetBody) =>
  page.evaluate(async (row) => {
    const db = await import('/src/db/storage.ts')
    await db.storage.writeRows([{ table: 'sets', row }])
  }, set)

const readLocalSet = (page: Page, id: string) =>
  page.evaluate(async (setId) => {
    const db = await import('/src/db/storage.ts')
    return db.storage.get('sets', setId) as Promise<SetBody | undefined>
  }, id)

test('wipe and restore matches the server export', async ({ page }) => {
  const user = claimUser()
  await seedFixture(user)
  await signIn(page, user)
  await runSync(page)
  // Not storage.deleteDatabase(): it rejects on blocked, and a read the page is still
  // finishing after the sync keeps the closing connection open for a moment. The delete
  // is only blocked until that read ends.
  await page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    const { DB_NAME } = await import('/src/db/constants.ts')
    const connection = await db.storage.connection()
    connection.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  })
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Seed Database' })).toHaveCount(0)
  const restored = page.waitForEvent('framenavigated')
  await page.getByRole('button', { name: 'Restore from cloud' }).click()
  await restored
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await import('/src/db/storage.ts')
        return db.storage.count('exercises')
      })
    )
    .toBe(21)
  const local = sortExport((await localStores(page)) as ExportFile)
  const remote = await exportStores(user.token)
  expect(local).toEqual(remote)
})

test('a first sync keeps the server set and pushes nothing for it', async ({ page }) => {
  const user = claimUser()
  await seedFixture(user)
  const original = await liftingSet(user.token)
  const edited = { ...original, set: { ...original.set, weight: original.set.weight + 9 } }
  const pushes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/push')) pushes.push(request.postData() ?? '')
  })
  await signIn(page, user)
  await writeSet(page, edited)
  await runSync(page)
  expect(pushes.some((body) => body.includes(edited.id))).toBe(false)
  const local = await readLocalSet(page, edited.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(original.set.weight)
})

test('a local-only set reaches D1', async ({ page }) => {
  const user = claimUser()
  await seedFixture(user)
  const set: SetBody = {
    id: 'local-only-set',
    sessionId: 'local-only-session',
    exerciseId: 'local-only-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 42 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, user)
  await writeSet(page, set)
  await runSync(page)
  const stored = (await pullAll(user.token)).find((row) => row.row.id === set.id)
  if (!stored || stored.table !== 'sets') throw new Error('missing local-only set')
  expect((stored.row.set as SetExecution).weight).toBe(42)
})

test('every local row reaches D1 when the server has no rows yet', async ({ page }) => {
  const user = claimUser()
  const set: SetBody = {
    id: 'empty-server-set',
    sessionId: 'empty-server-session',
    exerciseId: 'empty-server-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 8, weight: 15 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, user)
  await writeSet(page, set)
  await runSync(page)
  const stored = (await pullAll(user.token)).find((row) => row.row.id === set.id)
  if (!stored || stored.table !== 'sets') throw new Error('missing empty-server set')
  expect((stored.row.set as SetExecution).weight).toBe(15)
})

test('a crash after the first pull page converges with an uninterrupted sync', async ({ page, browser }) => {
  const crash = claimUser()
  const clean = claimUser()
  await seedFixture(crash)
  await seedFixture(clean)
  let pulls = 0
  await page.route('**/api/pull**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    pulls += 1
    if (pulls > 1) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await signIn(page, crash)
  await runSync(page).catch(() => undefined)
  expect(await cursorOf(page)).toBe(0)
  await page.unroute('**/api/pull**')
  await runSync(page)
  const crashLocal = sortExport((await localStores(page)) as ExportFile)
  const crashRemote = await exportStores(crash.token)

  // Another browser, with storage of its own, runs the same first sync without the crash.
  const cleanContext = await browser.newContext()
  const cleanPage = await cleanContext.newPage()
  await signIn(cleanPage, clean)
  await runSync(cleanPage)
  const cleanLocal = sortExport((await localStores(cleanPage)) as ExportFile)
  const cleanRemote = await exportStores(clean.token)
  await cleanContext.close()
  expect(crashLocal).toEqual(cleanLocal)
  expect(crashRemote).toEqual(cleanRemote)
})

test('three sets logged offline drain into D1', async ({ page }) => {
  const user = claimUser()
  await signIn(page, user)
  await page.evaluate(async () => {
    await import('/src/db/stores/workoutSessionsStore.ts')
    await import('/src/db/storage.ts')
  })
  await page.context().setOffline(true)
  const logged = await page.evaluate(async () => {
    const sessions = await import('/src/db/stores/workoutSessionsStore.ts')
    const db = await import('/src/db/storage.ts')
    const exerciseId = 'offline-exercise'
    const snapshot = {
      exerciseId,
      name: 'Bench press',
      kind: 'lifting' as const,
      preset: 'lifting' as const,
      muscle: 'chest' as const,
      targetSets: 3,
      defaults: { reps: 8 }
    }
    let session = await sessions.workoutSessionsStore.create({
      date: '2026-09-27',
      programId: 'offline-program',
      location: 'Home',
      exercises: [snapshot]
    })
    for (const weight of [10, 20, 30]) {
      session = await sessions.workoutSessionsStore.addSet(session, exerciseId, { preset: 'lifting', reps: 8, weight })
    }
    const queued = await db.storage.getAll<{ table: string; id: string }>('outbox')
    return {
      sessionId: session.id,
      setIds: queued.filter((entry) => entry.table === 'sets').map((entry) => entry.id)
    }
  })
  expect(logged.setIds).toHaveLength(3)
  await page.context().setOffline(false)
  await expect.poll(async () => (await outbox(page)).length).toBe(0)
  const stored = await pullAll(user.token)
  for (const id of logged.setIds) {
    expect(stored.some((row) => row.row.id === id)).toBe(true)
  }
})

test('a later edit survives the second sync after an empty server accepted the first push', async ({ page }) => {
  const user = claimUser()
  const set: SetBody = {
    id: 'steady-set',
    sessionId: 'steady-session',
    exerciseId: 'steady-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, user)
  await writeSet(page, set)
  await runSync(page)
  expect(await cursorOf(page)).not.toBe(0)
  await writeSet(page, { ...set, set: { ...set.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' })
  await runSync(page)
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  const stored = (await pullAll(user.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
})

test('a push already on the wire is not the last write after another page edits', async ({ page }) => {
  const user = claimUser()
  const set: SetBody = {
    id: 'wire-set',
    sessionId: 'wire-session',
    exerciseId: 'wire-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 40 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  const other = await page.context().newPage()
  await other.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
  })
  await signIn(page, user)
  await signIn(other, user)
  await page.evaluate(async (row) => {
    const db = await import('/src/db/storage.ts')
    const client = await import('/src/sync/syncClient.ts')
    await db.storage.writeRows([{ table: 'sets', row }])
    await client.sync()
  }, set)
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let sawPush: (() => void) | undefined
  const pushed = new Promise<void>((resolve) => {
    sawPush = resolve
  })
  let held = false
  await page.route('**/api/push', async (route) => {
    if (route.request().method() !== 'POST' || held) {
      await route.continue()
      return
    }
    held = true
    sawPush?.()
    await gate
    await route.continue()
  })
  const syncing = page.evaluate(async (row) => {
    const db = await import('/src/db/storage.ts')
    const client = await import('/src/sync/syncClient.ts')
    await db.storage.writeRows([{ table: 'sets', row }])
    await client.sync()
  }, set)
  await pushed
  const otherSync = other.evaluate(async (row) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    const locks = navigator.locks
    const original = locks.request.bind(locks) as (
      name: string,
      options?: unknown,
      callback?: unknown
    ) => Promise<unknown>
    locks.request = ((name: string, options?: unknown, callback?: unknown) => {
      if (name === 'jimbro:sync-push') Reflect.set(window, '__wireWaiting', true)
      if (typeof options === 'function') return original(name, options)
      return original(name, options, callback)
    }) as typeof locks.request
    const db = await import('/src/db/storage.ts')
    const client = await import('/src/sync/syncClient.ts')
    await db.storage.writeRows([
      { table: 'sets', row: { ...row, set: { ...row.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' } }
    ])
    await client.sync()
    Reflect.set(window, '__wireDone', true)
  }, set)
  await other.waitForFunction(() => Reflect.get(window, '__wireWaiting') === true)
  expect(await other.evaluate(() => Reflect.get(window, '__wireDone') === true)).toBe(false)
  const during = (await pullAll(user.token)).find((row) => row.row.id === set.id)
  const duringSet = during?.row.set
  if (!duringSet || typeof duringSet !== 'object' || !('weight' in duringSet)) {
    throw new Error('missing in-flight weight')
  }
  expect(duringSet.weight).toBe(40)
  release?.()
  await syncing
  await otherSync
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  expect(await outbox(page)).toHaveLength(0)
  const stored = (await pullAll(user.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
  await page.unroute('**/api/push')
  await other.close()
})

test('a first sync does not keep a set whose exercise left with the server header', async ({ page }) => {
  const user = claimUser()
  const snapshot = {
    exerciseId: 'exercise-a',
    name: 'A',
    kind: 'lifting' as const,
    preset: 'lifting' as const,
    targetSets: 1,
    defaults: {}
  }
  const header = {
    id: 'orphan-session',
    date: '2026-09-27',
    programId: 'orphan-program',
    location: 'Gym',
    status: 'incomplete' as const,
    exercises: [snapshot],
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  const kept = {
    id: 'orphan-session:exercise-a:0',
    sessionId: header.id,
    exerciseId: 'exercise-a',
    position: 0,
    set: { preset: 'lifting' as const, reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: header.updatedAt
  }
  const hidden = {
    ...kept,
    id: 'orphan-session:exercise-b:0',
    exerciseId: 'exercise-b',
    set: { preset: 'lifting' as const, reps: 5, weight: 42 }
  }
  await pushRows(user.token, [
    { table: 'sessions', row: header },
    { table: 'sets', row: kept }
  ])
  await signIn(page, user)
  await page.evaluate(
    async ({ serverHeader, extra }) => {
      const db = await import('/src/db/storage.ts')
      await db.storage.writeRows([
        {
          table: 'sessions',
          row: {
            ...serverHeader,
            exercises: [
              ...serverHeader.exercises,
              { ...serverHeader.exercises[0], exerciseId: 'exercise-b', name: 'B' }
            ],
            updatedAt: '2026-09-27T12:00:01.000Z'
          }
        },
        { table: 'sets', row: extra }
      ])
    },
    { serverHeader: header, extra: hidden }
  )
  await runSync(page)
  const localHeader = await page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    return db.storage.get('workoutSessions', 'orphan-session') as Promise<{
      exercises: Array<{ exerciseId: string }>
    } | null>
  })
  expect(localHeader?.exercises.map((exercise) => exercise.exerciseId)).toEqual(['exercise-a'])
  expect(await readLocalSet(page, hidden.id)).toBeUndefined()
  const rows = await pullAll(user.token)
  expect(rows.some((row) => row.row.id === hidden.id)).toBe(false)
  expect(rows.some((row) => row.row.id === kept.id)).toBe(true)
})

test('a failed restore stays on the page', async ({ page }) => {
  const user = claimUser()
  await page.route('**/api/pull**', (route) => route.fulfill({ status: 500, body: 'no' }))
  await signIn(page, user)
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore from cloud' }).click()
  await expect(page.locator('.toast-message-popup')).toHaveText('Failed to restore from cloud.')
  await expect(page).toHaveURL(/\/workouts/)
  await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
})

test('reset succeeds while another tab holds the database', async ({ page }) => {
  // Another tab, a page Chromium prerendered or a page in the back/forward cache all hold a connection, and each
  // closes it when the reset asks.
  const other = await page.context().newPage()
  await other.goto('/workouts/')
  await other.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    await db.storage.count('exercises')
  })
  await page.goto('/settings/')
  await page.locator('summary').filter({ hasText: 'Manage local data' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#reset-database').click()
  await expect(page.locator('.toast-message-popup')).toHaveText('Database reset.')
  // The other tab opens a new connection on its next read.
  const exerciseCount = await other.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    return db.storage.count('exercises')
  })
  expect(exerciseCount).toBe(0)
  await other.close()
})

test('restore joins the in-flight sync without logging an aborted rerun', async ({ page }) => {
  const user = claimUser()
  const failures: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('sync failed')) failures.push(message.text())
  })
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let pulls = 0
  await page.route('**/api/pull**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    pulls += 1
    if (pulls === 1) await gate
    await route.continue()
  })
  await signIn(page, user)
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
  const clicked = page.getByRole('button', { name: 'Restore from cloud' }).click()
  await expect.poll(() => pulls).toBe(1)
  release?.()
  await clicked
  expect(failures).toEqual([])
})

test('an open settings page shows the outbox count after an offline write', async ({ page }) => {
  const user = claimUser()
  const set: SetBody = {
    id: 'count-set',
    sessionId: 'count-session',
    exerciseId: 'count-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 15 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, user)
  await page.evaluate(async () => {
    await import('/src/db/storage.ts')
  })
  await page.context().setOffline(true)
  await writeSet(page, set)
  await expect(page.locator('#cloud-summary-status')).toHaveText('1 pending')
})

test('a write on another page moves the open settings count while offline', async ({ page }) => {
  const user = claimUser()
  const set: SetBody = {
    id: 'count-other-set',
    sessionId: 'count-other-session',
    exerciseId: 'count-other-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 20 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, user)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('jimbro:rows-written'))
  })
  await expect(page.locator('#cloud-summary-status')).toHaveText('0 pending')
  const workout = await page.context().newPage()
  await workout.goto('/workouts/')
  await workout.evaluate(async () => {
    await import('/src/db/storage.ts')
  })
  await page.context().setOffline(true)
  await writeSet(workout, set)
  await expect(page.locator('#cloud-summary-status')).not.toHaveText('0 pending')
})
