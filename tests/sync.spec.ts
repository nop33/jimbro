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
  gate: { token: 'gate', userId: 'user-gate' }
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
  if (!response.ok) throw new Error(`import ${user.userId} ${response.status} ${await response.text()}`)
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

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const tokens = Object.fromEntries(Object.values(USERS).map((user) => [user.token, user.userId]))
  writeFileSync(path.join(workerDir, '.dev.vars'), `AUTH_TOKENS=${JSON.stringify(tokens)}\n`)
  const probe = await fetch(`${API}/api/ping`, { headers: authHeaders('wipe') }).then(
    (response) => response.status,
    () => 0
  )
  if (probe === 200) return
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
    if (status === 200) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('wrangler dev did not answer on 8787')
})

test('wipe and restore matches the server export', async ({ page }) => {
  test.setTimeout(180_000)
  await importFixture(USERS.wipe)
  await signIn(page, USERS.wipe)
  await runSync(page)
  await page.evaluate(async () => {
    const db = await import('/src/db/storage.ts')
    await db.storage.deleteDatabase()
  })
  await page.goto('/workouts/')
  await expect(page.getByRole('button', { name: 'Seed Database' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Restore from cloud' }).click()
  await page.waitForURL('**/workouts/**')
  await signIn(page, USERS.wipe)
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
  await page.evaluate((iso) => localStorage.setItem('jimbro.cloudBackup.lastDate', iso), '2026-09-27T18:00:00.000Z')
  await writeSet(page, edited)
  await runSync(page)
  expect(pushes.some((body) => body.includes(edited.id))).toBe(true)
  const stored = (await pullAll(USERS.writer.token)).find((row) => row.row.id === edited.id)
  expect((stored?.row.set as SetExecution).weight).toBe(edited.set.weight)
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
  expect(local?.set.weight).toBe(original.set.weight)
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
  expect((stored?.row.set as SetExecution).weight).toBe(42)
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
  expect((stored?.row.set as SetExecution).weight).toBe(15)
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
    id: 'inflight-set',
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
  await page.route('**/api/push', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await gate
    await route.continue()
  })
  await signIn(page, USERS.inflight)
  await writeSet(page, set)
  const finished = page.evaluate(async () => {
    const client = await import('/src/sync/syncClient.ts')
    const db = await import('/src/db/storage.ts')
    await client.sync()
    const queued = await db.storage.readOutbox(20)
    const row = (await db.storage.get('sets', 'inflight-set')) as { set: { weight: number } } | undefined
    return { ids: queued.map((entry) => entry.id), weight: row?.set.weight }
  })
  await page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/push'))
  await writeSet(page, { ...set, set: { ...set.set, weight: 55 }, updatedAt: '2026-09-27T12:00:01.000Z' })
  release?.()
  const result = await finished
  expect(result.ids).toContain(set.id)
  expect(result.weight).toBe(55)
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
