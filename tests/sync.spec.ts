import { execFile } from 'node:child_process'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page } from '@playwright/test'

const execFileAsync = promisify(execFile)
const workerDir = path.resolve('worker')
const fixturePath = path.join(workerDir, 'test/fixtures/latest-v4.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { exportDate: string }
const API = 'http://127.0.0.1:8787'

const USERS = {
  wipe: { token: 'wipe', userId: 'user-wipe' },
  writer: { token: 'writer', userId: 'user-writer' },
  other: { token: 'other', userId: 'user-other' },
  local: { token: 'local', userId: 'user-local' },
  nocloud: { token: 'nocloud', userId: 'user-nocloud' },
  crash: { token: 'crash', userId: 'user-crash' },
  clean: { token: 'clean', userId: 'user-clean' },
  offline: { token: 'offline', userId: 'user-offline' },
  inflight: { token: 'inflight', userId: 'user-inflight' },
  gate: { token: 'gate', userId: 'user-gate' },
  steady: { token: 'steady', userId: 'user-steady' },
  restore: { token: 'restore', userId: 'user-restore' },
  count: { token: 'count', userId: 'user-count' },
  gap: { token: 'gap', userId: 'user-gap' },
  race: { token: 'race', userId: 'user-race' },
  orphan: { token: 'orphan', userId: 'user-orphan' }
} as const

type UserName = keyof typeof USERS
type User = (typeof USERS)[UserName]

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

let worker: ChildProcess | undefined

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

const pull = async (token: string, cursor: number) => {
  const response = await fetch(`${API}/api/pull?cursor=${cursor}&limit=1000`, { headers: authHeaders(token) })
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
  const response = await fetch(`${API}/api/export`, { headers: authHeaders(token) })
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

const putLatest = async (userId: string) => {
  await execFileAsync(
    'vp',
    [
      'exec',
      'wrangler',
      'r2',
      'object',
      'put',
      `jimbro-backups/users/${userId}/latest.json`,
      '--file',
      fixturePath,
      '--local'
    ],
    { cwd: workerDir }
  )
}

const importFixture = async (user: User) => {
  await putLatest(user.userId)
  const response = await fetch(`${API}/api/import-r2`, { method: 'POST', headers: authHeaders(user.token) })
  if (response.ok) return
  const body = await response.text()
  if (response.status === 409 && body.includes('already_imported')) return
  throw new Error(`import ${user.userId} ${response.status} ${body}`)
}

const signIn = async (page: Page, user: User) => {
  await page.goto('/settings/')
  const base = await page.evaluate(async () => {
    const backup = await import('/src/db/cloudBackup.ts')
    return backup.API_BASE as string
  })
  expect(base).toBe(API)
  await page.evaluate((credentials) => {
    localStorage.setItem('jimbro.cloudBackup', JSON.stringify(credentials))
    localStorage.removeItem('jimbro.sync.importRequired')
    localStorage.removeItem('jimbro.sync.lastAt')
    localStorage.removeItem('jimbro.cloudBackup.lastDate')
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
    return db.storage.readOutbox(50)
  })

const cursorOf = (page: Page) =>
  page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    return db.storage.getMeta('cursor')
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

const pushRows = async (token: string, rows: unknown[]) => {
  const response = await fetch(`${API}/api/push`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  })
  if (!response.ok) throw new Error(`push ${response.status} ${await response.text()}`)
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

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'The sync spec drives Chromium against a local worker.')
  const tokens = Object.fromEntries(Object.values(USERS).map((user) => [user.token, user.userId]))
  writeFileSync(path.join(workerDir, '.dev.vars'), `AUTH_TOKENS=${JSON.stringify(tokens)}\n`)
  const probe = await fetch(`${API}/api/ping`, { headers: authHeaders('wipe') }).then(
    (response) => response.status,
    () => 0
  )
  if (probe !== 200) {
    worker = spawn('vp', ['exec', 'wrangler', 'dev', '--local', '--port', '8787', '--ip', '127.0.0.1'], {
      cwd: workerDir,
      stdio: 'pipe'
    })
    worker.stdout?.on('data', (chunk) => process.stdout.write(chunk))
    worker.stderr?.on('data', (chunk) => process.stderr.write(chunk))
    const started = Date.now()
    while (Date.now() - started < 60_000) {
      const status = await fetch(`${API}/api/ping`, { headers: authHeaders('wipe') }).then(
        (response) => response.status,
        () => 0
      )
      if (status === 200) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const ready = await fetch(`${API}/api/ping`, { headers: authHeaders('wipe') }).then(
      (response) => response.status,
      () => 0
    )
    if (ready !== 200) throw new Error('wrangler dev did not answer on 8787')
  }
  await execFileAsync('vp', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'jimbro', '--local'], {
    cwd: workerDir,
    env: { ...process.env, CI: '1' }
  })
})

test('wipe and restore matches the server export', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    window.addEventListener('visibilitychange', (event) => event.stopPropagation(), true)
  })
  await importFixture(USERS.wipe)
  await signIn(page, USERS.wipe)
  await runSync(page)
  await page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    await db.storage.deleteDatabase()
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
  const remote = await exportStores(USERS.wipe.token)
  expect(local).toEqual(remote)
})

test('a snapshot writer pushes a differing local set', async ({ page }) => {
  test.setTimeout(180_000)
  await importFixture(USERS.writer)
  const original = await liftingSet(USERS.writer.token)
  const edited = { ...original, set: { ...original.set, weight: original.set.weight + 5 } }
  const pushes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/push')) pushes.push(request.postData() ?? '')
  })
  await signIn(page, USERS.writer)
  const laterThanImport = new Date(Date.parse(fixture.exportDate) + 1000).toISOString()
  await page.evaluate((iso) => localStorage.setItem('jimbro.cloudBackup.lastDate', iso), laterThanImport)
  await writeSet(page, edited)
  await runSync(page)
  expect(pushes.some((body) => body.includes(edited.id))).toBe(true)
  const stored = (await pullAll(USERS.writer.token)).find((row) => row.row.id === edited.id)
  if (!stored || stored.table !== 'sets') throw new Error('missing writer set')
  expect((stored.row.set as SetExecution).weight).toBe(edited.set.weight)
})

test('another browser keeps the server set and pushes nothing for it', async ({ page }) => {
  test.setTimeout(180_000)
  await importFixture(USERS.other)
  const original = await liftingSet(USERS.other.token)
  const edited = { ...original, set: { ...original.set, weight: original.set.weight + 9 } }
  const pushes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/push')) pushes.push(request.postData() ?? '')
  })
  await signIn(page, USERS.other)
  await page.evaluate((iso) => localStorage.setItem('jimbro.cloudBackup.lastDate', iso), '2020-01-01T00:00:00.000Z')
  await writeSet(page, edited)
  await runSync(page)
  expect(pushes.some((body) => body.includes(edited.id))).toBe(false)
  const local = await readLocalSet(page, edited.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(original.set.weight)
})

test('a local-only set reaches D1', async ({ page }) => {
  test.setTimeout(180_000)
  await importFixture(USERS.local)
  const set: SetBody = {
    id: 'local-only-set',
    sessionId: 'local-only-session',
    exerciseId: 'local-only-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 42 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.local)
  await writeSet(page, set)
  await runSync(page)
  const stored = (await pullAll(USERS.local.token)).find((row) => row.row.id === set.id)
  if (!stored || stored.table !== 'sets') throw new Error('missing local-only set')
  expect((stored.row.set as SetExecution).weight).toBe(42)
})

test('every local row reaches D1 when the user has no cloud snapshot', async ({ page }) => {
  const set: SetBody = {
    id: 'nocloud-set',
    sessionId: 'nocloud-session',
    exerciseId: 'nocloud-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 8, weight: 15 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.nocloud)
  await writeSet(page, set)
  await runSync(page)
  const stored = (await pullAll(USERS.nocloud.token)).find((row) => row.row.id === set.id)
  if (!stored || stored.table !== 'sets') throw new Error('missing no-cloud set')
  expect((stored.row.set as SetExecution).weight).toBe(15)
  await expect(page.locator('#cloud-summary-status')).not.toHaveText('Cloud import has not been run yet')
})

test('a crash after the first pull page converges with an uninterrupted sync', async ({ page }) => {
  test.setTimeout(180_000)
  await importFixture(USERS.crash)
  await importFixture(USERS.clean)
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
  await signIn(page, USERS.crash)
  await runSync(page)
  expect(await cursorOf(page)).toBe(0)
  await page.unroute('**/api/pull**')
  await runSync(page)
  const crashLocal = sortExport((await localStores(page)) as ExportFile)
  const crashRemote = await exportStores(USERS.crash.token)

  const clean = await page.context().newPage()
  await signIn(clean, USERS.clean)
  await runSync(clean)
  const cleanLocal = sortExport((await localStores(clean)) as ExportFile)
  const cleanRemote = await exportStores(USERS.clean.token)
  expect(crashLocal).toEqual(cleanLocal)
  expect(crashRemote).toEqual(cleanRemote)
  await clean.close()
})

test('three sets logged offline drain into D1', async ({ page }) => {
  await signIn(page, USERS.offline)
  await page.evaluate(async () => {
    await import('/src/db/stores/workoutSessionsStore.ts')
    await import('/src/db/storage.ts')
  })
  await page.context().setOffline(true)
  const logged = await page.evaluate(async () => {
    const sessions = await import('/src/db/stores/workoutSessionsStore.ts')
    const db = await import('/src/db/storage.ts')
    const exerciseId = 'offline-exercise'
    const execution = {
      exerciseId,
      name: 'Bench press',
      kind: 'lifting' as const,
      preset: 'lifting' as const,
      muscle: 'chest' as const,
      targetSets: 3,
      defaults: { reps: 8 },
      sets: [] as Array<{ preset: 'lifting'; reps: number; weight: number }>
    }
    let session = await sessions.workoutSessionsStore.createWorkoutSession({
      date: '2026-09-27',
      programId: 'offline-program',
      location: 'Home',
      status: 'incomplete',
      exercises: [execution]
    })
    for (const weight of [10, 20, 30]) {
      session = await sessions.workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
        workoutSession: session,
        exerciseId,
        exerciseExecutionSet: { preset: 'lifting', reps: 8, weight }
      })
    }
    const queued = await db.storage.readOutbox(20)
    return {
      sessionId: session.id,
      setIds: queued.filter((entry) => entry.table === 'sets').map((entry) => entry.id)
    }
  })
  expect(logged.setIds).toHaveLength(3)
  await page.context().setOffline(false)
  await expect.poll(async () => (await outbox(page)).length, { timeout: 15_000 }).toBe(0)
  const stored = await pullAll(USERS.offline.token)
  for (const id of logged.setIds) {
    expect(stored.some((row) => row.row.id === id)).toBe(true)
  }
})

test('an edit during a slow push stays in the outbox', async ({ page }) => {
  const set: SetBody = {
    id: `inflight-${Date.now()}`,
    sessionId: 'inflight-session',
    exerciseId: 'inflight-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 40 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let sawPush: (() => void) | undefined
  const pushed = new Promise<void>((resolve) => {
    sawPush = resolve
  })
  await page.route('**/api/push', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    sawPush?.()
    await gate
    await route.continue()
  })
  await signIn(page, USERS.inflight)
  await writeSet(page, set)
  const finished = page.evaluate(async (setId) => {
    const client = await import('/src/sync/syncClient.ts')
    const db = await import('/src/db/storage.ts')
    const original = db.storage.deleteOutboxIfUnchanged.bind(db.storage)
    let snap: { ids: string[]; weight?: number } | null = null
    db.storage.deleteOutboxIfUnchanged = async (entries, advance) => {
      await original(entries, advance)
      if (snap) return
      const queued = await db.storage.readOutbox(20)
      const row = (await db.storage.get('sets', setId)) as { set: { weight: number } } | undefined
      snap = { ids: queued.map((entry) => entry.id), weight: row?.set.weight }
    }
    await client.sync()
    return snap
  }, set.id)
  await pushed
  await writeSet(page, { ...set, set: { ...set.set, weight: 55 }, updatedAt: '2026-09-27T12:00:01.000Z' })
  release?.()
  const result = await finished
  expect(result?.ids).toContain(set.id)
  expect(result?.weight).toBe(55)
})

test('settings reports import_required and keeps the outbox', async ({ page }) => {
  await putLatest(USERS.gate.userId)
  const set: SetBody = {
    id: 'gate-set',
    sessionId: 'gate-session',
    exerciseId: 'gate-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 12 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.gate)
  await writeSet(page, set)
  await page.reload()
  await expect(page.locator('#cloud-summary-status')).toHaveText('Cloud import has not been run yet', {
    timeout: 15_000
  })
  const queued = await outbox(page)
  expect(queued.some((entry) => entry.id === set.id)).toBe(true)
})

test('a later edit survives the second sync after an empty server accepted the first push', async ({ page }) => {
  const set: SetBody = {
    id: 'steady-set',
    sessionId: 'steady-session',
    exerciseId: 'steady-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.steady)
  await writeSet(page, set)
  await runSync(page)
  expect(await cursorOf(page)).not.toBe(0)
  await writeSet(page, { ...set, set: { ...set.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' })
  await runSync(page)
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  const stored = (await pullAll(USERS.steady.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
})

test('a stop after an empty-server push ack keeps the cursor and the next edit', async ({ page }) => {
  const set: SetBody = {
    id: 'gap-set',
    sessionId: 'gap-session',
    exerciseId: 'gap-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  let pulls = 0
  await page.route('**/api/pull**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    pulls += 1
    if (pulls > 1) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' },
      body: JSON.stringify({ rows: [], cursor: 0, more: false, importedExportDate: null })
    })
  })
  await signIn(page, USERS.gap)
  const cursorAfterAck = await page.evaluate(async (row) => {
    const client = await import('/src/sync/syncClient.ts')
    const db = await import('/src/db/storage.ts')
    const original = db.storage.deleteOutboxIfUnchanged.bind(db.storage)
    let stopped = false
    db.storage.deleteOutboxIfUnchanged = async (entries, advance) => {
      await original(entries, advance)
      if (stopped) return
      stopped = true
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      throw new Error('stop after outbox ack')
    }
    await db.storage.writeRows([{ table: 'sets', row }])
    await client.sync()
    return db.storage.getMeta('cursor')
  }, set)
  expect(cursorAfterAck).not.toBe(0)
  await page.unroute('**/api/pull**')
  await page.evaluate(async (row) => {
    const db = await import('/src/db/storage.ts')
    await db.storage.writeRows([
      { table: 'sets', row: { ...row, set: { ...row.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' } }
    ])
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  }, set)
  await runSync(page)
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  const stored = (await pullAll(USERS.gap.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
})

test('a later edit survives when the empty-server push landed but the ack did not', async ({ page }) => {
  const set: SetBody = {
    id: 'unacked-set',
    sessionId: 'unacked-session',
    exerciseId: 'unacked-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  let pulls = 0
  await page.route('**/api/pull**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    pulls += 1
    if (pulls > 1) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' },
      body: JSON.stringify({ rows: [], cursor: 0, more: false, importedExportDate: null })
    })
  })
  await signIn(page, USERS.gap)
  const cursorAfterStop = await page.evaluate(async (row) => {
    const client = await import('/src/sync/syncClient.ts')
    const db = await import('/src/db/storage.ts')
    const original = db.storage.deleteOutboxIfUnchanged.bind(db.storage)
    let stopped = false
    db.storage.deleteOutboxIfUnchanged = async (entries, advance) => {
      if (!stopped) {
        stopped = true
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
        throw new Error('stop before outbox ack')
      }
      await original(entries, advance)
    }
    await db.storage.writeRows([{ table: 'sets', row }])
    await client.sync()
    return db.storage.getMeta('cursor')
  }, set)
  expect(cursorAfterStop).toBe(0)
  await page.unroute('**/api/pull**')
  await page.evaluate(async (row) => {
    const db = await import('/src/db/storage.ts')
    await db.storage.writeRows([
      { table: 'sets', row: { ...row, set: { ...row.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' } }
    ])
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  }, set)
  await runSync(page)
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  const stored = (await pullAll(USERS.gap.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
})

test('a later edit between the read and the inflight mark survives an unacked push', async ({ page }) => {
  const set: SetBody = {
    id: `race-set-${Date.now()}`,
    sessionId: 'race-session',
    exerciseId: 'race-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 10 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  let pulls = 0
  await page.route('**/api/pull**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    pulls += 1
    if (pulls > 1) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' },
      body: JSON.stringify({ rows: [], cursor: 0, more: false, importedExportDate: null })
    })
  })
  await signIn(page, USERS.race)
  const cursorAfterStop = await page.evaluate(async (row) => {
    const client = await import('/src/sync/syncClient.ts')
    const db = await import('/src/db/storage.ts')
    const originalRead = db.storage.readOutboxRows.bind(db.storage)
    const originalAck = db.storage.deleteOutboxIfUnchanged.bind(db.storage)
    let edited = false
    let stopped = false
    db.storage.readOutboxRows = async (entries) => {
      const loaded = await originalRead(entries)
      if (!edited) {
        edited = true
        await db.storage.writeRows([
          { table: 'sets', row: { ...row, set: { ...row.set, weight: 99 }, updatedAt: '2026-09-27T12:00:01.000Z' } }
        ])
      }
      return loaded
    }
    db.storage.deleteOutboxIfUnchanged = async (entries, advance) => {
      if (!stopped) {
        stopped = true
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
        throw new Error('stop before outbox ack')
      }
      await originalAck(entries, advance)
    }
    await db.storage.writeRows([{ table: 'sets', row }])
    await client.sync()
    return db.storage.getMeta('cursor')
  }, set)
  expect(cursorAfterStop).toBe(0)
  await page.unroute('**/api/pull**')
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  })
  await runSync(page)
  const local = await readLocalSet(page, set.id)
  if (!local) throw new Error('missing local set')
  expect(local.set.weight).toBe(99)
  const stored = (await pullAll(USERS.race.token)).find((row) => row.row.id === set.id)
  if (!stored) throw new Error('missing uploaded set')
  const uploaded = stored.row.set
  if (!uploaded || typeof uploaded !== 'object' || !('weight' in uploaded)) throw new Error('missing uploaded weight')
  expect(uploaded.weight).toBe(99)
})

test('a non-writer does not keep a set whose exercise left with the server header', async ({ page }) => {
  const snapshot = {
    exerciseId: 'exercise-a',
    name: 'A',
    kind: 'lifting',
    preset: 'lifting',
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
  await pushRows(USERS.orphan.token, [
    { table: 'sessions', row: header },
    { table: 'sets', row: kept }
  ])
  await signIn(page, USERS.orphan)
  await page.evaluate((iso) => localStorage.setItem('jimbro.cloudBackup.lastDate', iso), '2020-01-01T00:00:00.000Z')
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
  const rows = await pullAll(USERS.orphan.token)
  expect(rows.some((row) => row.row.id === hidden.id)).toBe(false)
  expect(rows.some((row) => row.row.id === kept.id)).toBe(true)
})

test('restore joins the in-flight sync without logging an aborted rerun', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('visibilitychange', (event) => event.stopPropagation(), true)
  })
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
  await signIn(page, USERS.restore)
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Restore from cloud' })).toBeVisible()
  const clicked = page.getByRole('button', { name: 'Restore from cloud' }).click()
  await expect.poll(() => pulls).toBe(1)
  release?.()
  await clicked
  expect(failures).toEqual([])
})

test('an open settings page shows the outbox count after an offline write', async ({ page }) => {
  const set: SetBody = {
    id: 'count-set',
    sessionId: 'count-session',
    exerciseId: 'count-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 15 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.count)
  await page.evaluate(async () => {
    await import('/src/db/storage.ts')
  })
  await page.context().setOffline(true)
  await writeSet(page, set)
  await expect(page.locator('#cloud-summary-status')).toHaveText('1 pending')
})

test('a write on another page moves the open settings count while offline', async ({ page }) => {
  const set: SetBody = {
    id: 'tabs-set',
    sessionId: 'tabs-session',
    exerciseId: 'tabs-exercise',
    position: 0,
    set: { preset: 'lifting', reps: 5, weight: 20 },
    isDeleted: false,
    updatedAt: '2026-09-27T12:00:00.000Z'
  }
  await signIn(page, USERS.count)
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
