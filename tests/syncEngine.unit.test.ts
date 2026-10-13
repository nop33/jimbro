import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import { Storage } from '../src/db/storage'
import { pullAll } from '../src/sync/pull'
import { getMeta, restartFirstSync, type OutboxEntry } from '../src/sync/queue'
import type { SyncServer } from '../src/sync/server'
import { createSync } from '../src/sync/syncEngine'
import type { ExerciseRow, Row, SessionHeader, SetRow } from '../src/db/types'
import { memoryServer, sharedLock, testPage } from './memoryServer'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const AT = '2026-10-01T12:00:00.000Z'
const LATER = '2026-10-01T12:00:01.000Z'

const exercise = (id: string, name: string, updatedAt = AT): Row => ({
  table: 'exercises',
  row: {
    id,
    name,
    kind: 'lifting',
    preset: 'lifting',
    targetSets: 3,
    defaults: { reps: 5 },
    isDeleted: false,
    updatedAt
  }
})

const header = (id: string, exerciseIds: string[], updatedAt = AT): Row => ({
  table: 'sessions',
  row: {
    id,
    date: '2026-10-01',
    programId: 'program',
    location: 'Gym',
    status: 'incomplete',
    exercises: exerciseIds.map((exerciseId) => ({
      exerciseId,
      name: exerciseId,
      kind: 'lifting',
      preset: 'lifting',
      targetSets: 1,
      defaults: {}
    })),
    isDeleted: false,
    updatedAt
  }
})

const set = (sessionId: string, exerciseId: string, weight: number, updatedAt = AT): Row => ({
  table: 'sets',
  row: {
    id: `${sessionId}:${exerciseId}:0`,
    sessionId,
    exerciseId,
    position: 0,
    set: { preset: 'lifting', reps: 5, weight },
    isDeleted: false,
    updatedAt
  }
})

const nameOf = (row: Row | ExerciseRow | undefined) => {
  const value = row && 'table' in row ? row.row : row
  return value && 'name' in value ? value.name : undefined
}

const weightOf = (row: Row | SetRow | undefined) => {
  const value = row && 'table' in row ? row.row : row
  return value && 'set' in value && 'weight' in value.set ? value.set.weight : undefined
}

const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// A storage on a database of its own, so two devices in one test keep apart.
const freshStorage = async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const storage = new Storage()
  await storage.connection()
  return storage
}

const syncFor = (storage: Storage, server: SyncServer, page = testPage()) =>
  createSync({ storage, server, lock: sharedLock().lock, page: page.page })

// Runs a task once, before the first pull this server answers.
const beforeFirstPull = (server: SyncServer, task: () => Promise<void>): SyncServer => {
  let ran = false
  return {
    ...server,
    async pull(cursor) {
      if (!ran) {
        ran = true
        await task()
      }
      return server.pull(cursor)
    }
  }
}

const outboxOf = (storage: Storage) => storage.getAll<OutboxEntry>(OBJECT_STORES.OUTBOX)

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((left, right) => left.id.localeCompare(right.id))

const idsOf = (rows: Array<{ id: string }>) => byId(rows).map((row) => row.id)

// What a device shows: every row it stores and the sets each session reads from setGroups.
const localState = async (storage: Storage) => ({
  exercises: byId(await storage.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES)),
  sessions: byId(await storage.getAll<SessionHeader>(OBJECT_STORES.WORKOUT_SESSIONS)),
  sets: byId(await storage.getAll<SetRow>(OBJECT_STORES.SETS)),
  setGroups: (await storage.getAll<{ sessionId: string; sets: SetRow[] }>(OBJECT_STORES.SET_GROUPS)).map((group) => ({
    sessionId: group.sessionId,
    sets: byId(group.sets)
  }))
})

let device: Storage

beforeEach(async () => {
  device = await freshStorage()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('first sync', () => {
  it('pulls every page, stores the server rows and moves the cursor to the last revision', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AT)
    const server = memoryServer({ pageSize: 2 })
    server.seed(['a', 'b', 'c', 'd', 'e'].map((id) => exercise(id, id)))
    const page = testPage()
    await syncFor(device, server, page).sync()
    expect(server.pulls).toEqual([0, 2, 4])
    expect(idsOf(await device.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(await getMeta(device, 'cursor')).toBe(5)
    expect(server.received).toEqual([])
    expect(page.notices).toEqual(['sync-settled'])
    expect(page.synced).toEqual([AT])
  })

  it('restores rows the caller pulled already without pulling again, and ignores them once synced', async () => {
    const server = memoryServer({ pageSize: 2 })
    server.seed(['a', 'b', 'c'].map((id) => exercise(id, id)))
    const restoring = await pullAll((cursor) => server.pull(cursor))
    server.pulls.length = 0
    await device.writeRows([exercise('phone', 'Phone only')])
    const engine = syncFor(device, server)
    await engine.sync({ restoring })
    expect(server.pulls).toEqual([])
    expect(idsOf(await device.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES))).toEqual(['a', 'b', 'c', 'phone'])
    expect(await getMeta(device, 'cursor')).toBe(3)
    expect(server.received.flat().map((pushed) => pushed.row.id)).toEqual(['phone'])

    await engine.sync({ restoring: { rows: [exercise('stale', 'Stale')], cursor: 9 } })
    expect(await device.get(OBJECT_STORES.EXERCISES, 'stale')).toBeUndefined()
    expect(await getMeta(device, 'cursor')).toBe(3)
  })

  it('keeps the server copy of a row both sides have and pushes nothing for it', async () => {
    const server = memoryServer()
    server.seed([exercise('squat', 'Squat')])
    await device.writeRows([exercise('squat', 'Phone squat', LATER)])
    await syncFor(device, server).sync()
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Squat')
    expect(server.received).toEqual([])
    expect(await outboxOf(device)).toEqual([])
  })

  it('pushes the rows only this device has', async () => {
    const server = memoryServer()
    server.seed([exercise('squat', 'Squat')])
    await device.writeRows([exercise('bench', 'Bench')])
    await syncFor(device, server).sync()
    expect(server.received.map((batch) => batch.map((row) => row.row.id))).toEqual([['bench']])
    expect(nameOf(server.rows.get('exercises:bench'))).toBe('Bench')
    expect(await outboxOf(device)).toEqual([])
    expect(await getMeta(device, 'cursor')).toBe(1)
  })

  it('moves the cursor to the revision of its push on a server with no rows', async () => {
    const server = memoryServer()
    await device.writeRows([exercise('squat', 'Squat'), exercise('bench', 'Bench')])
    await syncFor(device, server).sync()
    expect([...server.rows.keys()].sort()).toEqual(['exercises:bench', 'exercises:squat'])
    expect(await getMeta(device, 'cursor')).toBe(2)
    expect(await getMeta(device, 'bootstrapped')).toBe(0)
  })

  it('marks an empty database on an empty server bootstrapped, so the next sync only pushes', async () => {
    const server = memoryServer()
    const sync = syncFor(device, server)
    await sync.sync()
    expect(await getMeta(device, 'bootstrapped')).toBe(1)
    expect(await getMeta(device, 'cursor')).toBe(0)

    // A first sync would keep the server's copy. A later sync pushes this device's edit and pulls nothing.
    server.seed([exercise('squat', 'Server squat')])
    await device.writeRows([exercise('squat', 'Phone squat', LATER)])
    await sync.sync()
    expect(nameOf(server.rows.get('exercises:squat'))).toBe('Phone squat')
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Phone squat')
  })

  it('keeps an edit made while it pulls, and pushes it', async () => {
    const server = memoryServer()
    server.seed([set('session', 'squat', 10)])
    const editing = beforeFirstPull(server, () => device.writeRows([set('session', 'squat', 99, LATER)]))
    await syncFor(device, editing).sync()
    expect(weightOf(await device.get<SetRow>(OBJECT_STORES.SETS, 'session:squat:0'))).toBe(99)
    expect(weightOf(server.rows.get('sets:session:squat:0'))).toBe(99)
    expect(await outboxOf(device)).toEqual([])
  })

  it('drops a local set whose exercise left with the server header', async () => {
    const server = memoryServer()
    server.seed([header('session', ['a']), set('session', 'a', 10)])
    await device.writeRows([header('session', ['a', 'b'], LATER), set('session', 'b', 42)])
    await syncFor(device, server).sync()
    const local = await localState(device)
    expect(local.sessions.map((row) => row.exercises.map((snapshot) => snapshot.exerciseId))).toEqual([['a']])
    expect(local.sets.map((row) => row.id)).toEqual(['session:a:0'])
    expect(local.setGroups).toEqual([{ sessionId: 'session', sets: local.sets }])
    expect([...server.rows.keys()].sort()).toEqual(['sessions:session', 'sets:session:a:0'])
    expect(await outboxOf(device)).toEqual([])
  })

  it('converges after a pull fails part way with a first sync that never failed', async () => {
    const serverRows = [
      exercise('both', 'Server name'),
      exercise('server-only', 'Server only'),
      header('session', ['server-only']),
      set('session', 'server-only', 10)
    ]
    const localRows = [exercise('both', 'Phone name', LATER), exercise('phone-only', 'Phone only')]

    const crashServer = memoryServer({ pageSize: 2 })
    crashServer.seed(serverRows)
    await device.writeRows(localRows)
    let pulls = 0
    const failing: SyncServer = {
      ...crashServer,
      async pull(cursor) {
        pulls += 1
        if (pulls === 2) throw new Error('pull failed')
        return crashServer.pull(cursor)
      }
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const crashSync = syncFor(device, failing)
    await expect(crashSync.sync()).rejects.toThrow('pull failed')
    expect(await getMeta(device, 'cursor')).toBe(0)
    expect(crashServer.received).toEqual([])
    await crashSync.sync()

    // The same end as a first sync that never failed: the server's copy of the shared row, the phone's own row pushed,
    // and the cursor at the last of the 4 rows pulled.
    const local = await localState(device)
    expect(local.exercises.map((row) => [row.id, row.name])).toEqual([
      ['both', 'Server name'],
      ['phone-only', 'Phone only'],
      ['server-only', 'Server only']
    ])
    expect(local.sessions.map((row) => [row.id, row.exercises.map((snapshot) => snapshot.exerciseId)])).toEqual([
      ['session', ['server-only']]
    ])
    expect(local.sets.map((row) => [row.id, weightOf(row)])).toEqual([['session:server-only:0', 10]])
    expect(local.setGroups).toEqual([{ sessionId: 'session', sets: local.sets }])
    expect(await getMeta(device, 'cursor')).toBe(4)
    expect(crashServer.received.map((batch) => batch.map((row) => row.row.id))).toEqual([['phone-only']])
    expect([...crashServer.rows.keys()].sort()).toEqual([
      'exercises:both',
      'exercises:phone-only',
      'exercises:server-only',
      'sessions:session',
      'sets:session:server-only:0'
    ])
    expect(nameOf(crashServer.rows.get('exercises:both'))).toBe('Server name')
  })
})

describe('a synced database', () => {
  // Counts each request the sync sends, in order.
  const logged = (server: ReturnType<typeof memoryServer>) => {
    const calls: string[] = []
    const counted: SyncServer = {
      ...server,
      async push(rows) {
        calls.push('push')
        return server.push(rows)
      },
      async pull(cursor) {
        calls.push(`pull ${cursor}`)
        return server.pull(cursor)
      }
    }
    return { counted, calls }
  }

  it('pushes the outbox and never pulls', async () => {
    const server = memoryServer({ pageSize: 2 })
    server.seed([exercise('squat', 'Squat')])
    const { counted, calls } = logged(server)
    const page = testPage()
    const sync = syncFor(device, counted, page)
    await sync.sync()
    expect(calls).toEqual(['pull 0'])
    calls.length = 0

    server.seed([exercise('a', 'A'), exercise('b', 'B'), exercise('c', 'C')])
    await device.writeRows([exercise('bench', 'Bench')])
    await sync.sync()
    expect(calls).toEqual(['push'])
    expect(nameOf(server.rows.get('exercises:bench'))).toBe('Bench')
    expect(await outboxOf(device)).toEqual([])
    // Rows another device pushed stay on the server. A second device is not supported, and this one never pulls them.
    expect(byId(await device.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES)).map((row) => row.id)).toEqual([
      'bench',
      'squat'
    ])
    expect(await getMeta(device, 'cursor')).toBe(1)
    expect(page.notices).toEqual(['sync-settled', 'sync-settled'])
    expect(page.synced).toHaveLength(2)
  })

  it('sends no request when nothing is queued, and still settles', async () => {
    const server = memoryServer()
    server.seed([exercise('squat', 'Squat')])
    const { counted, calls } = logged(server)
    const page = testPage()
    const sync = syncFor(device, counted, page)
    await sync.sync()
    calls.length = 0

    server.seed([exercise('squat', 'Server squat', LATER)])
    await sync.sync()
    expect(calls).toEqual([])
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Squat')
    expect(page.notices).toEqual(['sync-settled', 'sync-settled'])
    expect(page.synced).toHaveLength(2)
  })

  it('pushes over the server copy of a row it edits', async () => {
    const server = memoryServer()
    server.seed([exercise('squat', 'Squat')])
    const sync = syncFor(device, server)
    await sync.sync()

    server.seed([exercise('squat', 'Server squat', LATER)])
    await device.writeRows([exercise('squat', 'Phone squat', '2026-10-01T12:00:02.000Z')])
    await sync.sync()
    expect(nameOf(server.rows.get('exercises:squat'))).toBe('Phone squat')
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Phone squat')
  })
})

describe('sync()', () => {
  it('settles and sends nothing while the server is unreachable', async () => {
    const server = memoryServer()
    server.setReachable(false)
    await device.writeRows([exercise('squat', 'Squat')])
    const page = testPage()
    await syncFor(device, server, page).sync()
    expect(page.notices).toEqual(['sync-settled'])
    expect(page.synced).toEqual([])
    expect(server.pulls).toEqual([])
    expect(server.received).toEqual([])
  })

  it('joins a running sync and runs once more after it, however many calls came in between', async () => {
    const server = memoryServer()
    const release = deferred()
    let checks = 0
    const gated: SyncServer = {
      ...server,
      reachable: () => {
        checks += 1
        return true
      },
      async pull(cursor) {
        if (server.pulls.length === 0) await release.promise
        return server.pull(cursor)
      }
    }
    const page = testPage()
    const sync = syncFor(device, gated, page)
    const first = sync.sync()
    expect(sync.sync()).toBe(first)
    expect(sync.sync()).toBe(first)
    release.resolve()
    await first
    await vi.waitFor(() => expect(page.notices).toEqual(['sync-settled', 'sync-settled']))
    // A third run would start in the microtask after the second one settles.
    await new Promise((resolve) => setTimeout(resolve))
    expect(checks).toBe(4)
    // The second run finds the database synced, so it only pushes, and nothing is queued.
    expect(server.pulls).toEqual([0])
    expect(page.synced).toHaveLength(2)
  })

  it('queues no further run for a call that passes again: false', async () => {
    const server = memoryServer()
    const release = deferred()
    let checks = 0
    const gated: SyncServer = {
      ...server,
      reachable: () => {
        checks += 1
        return true
      },
      async pull(cursor) {
        await release.promise
        return server.pull(cursor)
      }
    }
    const page = testPage()
    const sync = syncFor(device, gated, page)
    const first = sync.sync()
    expect(sync.sync({ again: false })).toBe(first)
    release.resolve()
    await first
    // A run queued after the first would check the server in the microtask after it settles.
    await new Promise((resolve) => setTimeout(resolve))
    expect(checks).toBe(2)
    expect(page.notices).toEqual(['sync-settled'])
    expect(server.pulls).toEqual([0])
  })

  it.each(['pull', 'push'] as const)(
    'rejects, logs, settles and tells the page why when a %s fails',
    async (request) => {
      const server = memoryServer()
      // Such as the row_limit a full backup answers with, which the page shows.
      const failure = new Error('row_limit')
      const failing: SyncServer = {
        ...server,
        [request]: async () => {
          throw failure
        }
      }
      await device.writeRows([exercise('squat', 'Squat')])
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const page = testPage()
      await expect(syncFor(device, failing, page).sync()).rejects.toBe(failure)
      expect(logged).toHaveBeenCalledWith('sync failed', failure)
      expect(page.failures).toEqual([failure])
      expect(page.notices).toEqual(['sync-settled'])
      expect(page.synced).toEqual([])
    }
  )

  it('resolves without logging when a request fails while the page is leaving', async () => {
    const server = memoryServer()
    const failing: SyncServer = {
      ...server,
      pull: async () => {
        throw new Error('aborted')
      }
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const page = testPage()
    page.leave()
    await syncFor(device, failing, page).sync()
    expect(logged).not.toHaveBeenCalled()
    expect(page.failures).toEqual([])
    expect(page.synced).toEqual([])
    expect(page.notices).toEqual(['sync-settled'])
  })
})

describe('restartFirstSync', () => {
  const keysOf = (server: ReturnType<typeof memoryServer>) => [...server.rows.keys()].sort()
  const deviceKeys = ['exercises:bench', 'exercises:squat', 'sessions:session', 'sets:session:squat:0']
  const deviceRows = [
    exercise('squat', 'Squat'),
    exercise('bench', 'Bench'),
    header('session', ['squat']),
    set('session', 'squat', 60)
  ]

  it('gives a new account every row of a device that synced with another one', async () => {
    const accountA = memoryServer()
    await device.writeRows(deviceRows)
    await syncFor(device, accountA).sync()
    expect(keysOf(accountA)).toEqual(deviceKeys)
    expect(await outboxOf(device)).toEqual([])

    // The device synced with account A, then the user creates passkey account B.
    await restartFirstSync(device)
    const accountB = memoryServer()
    await syncFor(device, accountB).sync()

    expect(keysOf(accountB)).toEqual(deviceKeys)
    for (const row of deviceRows) expect(accountB.rows.get(`${row.table}:${row.row.id}`)?.row).toEqual(row.row)
    expect(accountA.received).toHaveLength(1)
    expect(await outboxOf(device)).toEqual([])
    expect(await getMeta(device, 'cursor')).toBe(4)
  })

  it('restores the account signed in to and pushes it the rows only this device has', async () => {
    await device.writeRows(deviceRows)
    await syncFor(device, memoryServer()).sync()

    await restartFirstSync(device)
    const account = memoryServer()
    account.seed([exercise('deadlift', 'Deadlift'), exercise('squat', 'Back squat')])
    await syncFor(device, account).sync()

    const local = await localState(device)
    expect(local.exercises.map((row) => [row.id, row.name])).toEqual([
      ['bench', 'Bench'],
      ['deadlift', 'Deadlift'],
      ['squat', 'Back squat']
    ])
    expect(keysOf(account)).toEqual([
      'exercises:bench',
      'exercises:deadlift',
      'exercises:squat',
      'sessions:session',
      'sets:session:squat:0'
    ])
  })

  it('keeps queued edits, and lets the new account win over an edit the account before never acked', async () => {
    const accountA = memoryServer()
    await device.writeRows(deviceRows)
    await syncFor(device, accountA).sync()
    // A push of Front squat reaches account A without an ack, then the user renames it again.
    await device.writeRows([exercise('squat', 'Front squat', LATER)])
    const lost: SyncServer = {
      ...accountA,
      async push(batch) {
        await accountA.push(batch)
        throw new Error('connection lost')
      }
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(syncFor(device, lost).sync()).rejects.toThrow('connection lost')
    await device.writeRows([exercise('squat', 'Split squat', '2026-10-01T12:00:02.000Z')])

    // Account B holds the same Front squat. The push to account A says nothing about B, so B's copy wins as in any
    // first sync. Had the device kept the account A push in mind, it would take B's copy for its own lost push and
    // push Split squat over it.
    await restartFirstSync(device)
    expect(await getMeta(device, 'cursor')).toBe(0)
    expect(await getMeta(device, 'bootstrapped')).toBe(0)
    const accountB = memoryServer()
    accountB.seed([exercise('squat', 'Front squat', LATER)])
    await syncFor(device, accountB).sync()
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Front squat')
    expect(nameOf(accountB.rows.get('exercises:squat'))).toBe('Front squat')
    expect(keysOf(accountB)).toEqual(deviceKeys)
    expect(await outboxOf(device)).toEqual([])
  })

  it('runs a first sync again on a database that was bootstrapped empty', async () => {
    await syncFor(device, memoryServer()).sync()
    expect(await getMeta(device, 'bootstrapped')).toBe(1)

    await restartFirstSync(device)
    const account = memoryServer()
    account.seed([exercise('squat', 'Squat')])
    await syncFor(device, account).sync()
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Squat')
  })

  // Signing in on a phone that holds rows: the account's copy wins for every row both sides have, as in any first
  // sync. Local winning would let a seeded new phone, whose sample rows all wait in the outbox, overwrite the account's
  // edited exercises. So the page asks before signing in on a phone with data.
  it('keeps the account copy of rows a signed-out phone edited, and the rows only the phone has', async () => {
    await device.writeRows([
      exercise('squat', 'My squat', LATER),
      exercise('bench', 'Bench'),
      header('shared-session', ['squat', 'bench'], LATER),
      set('shared-session', 'bench', 40)
    ])
    await restartFirstSync(device)
    const account = memoryServer()
    account.seed([exercise('squat', 'Back squat'), header('shared-session', ['squat'])])
    await syncFor(device, account).sync()

    const local = await localState(device)
    expect(local.exercises.map((row) => [row.id, row.name])).toEqual([
      ['bench', 'Bench'],
      ['squat', 'Back squat']
    ])
    // The header reverts to the account's, so the phone's set of an exercise the account's header lacks goes too.
    expect(local.sessions.map((row) => row.exercises.map((snapshot) => snapshot.exerciseId))).toEqual([['squat']])
    expect(local.sets).toEqual([])
    expect(nameOf(account.rows.get('exercises:squat'))).toBe('Back squat')
    expect(nameOf(account.rows.get('exercises:bench'))).toBe('Bench')
    expect(await outboxOf(device)).toEqual([])
  })

  // Signing out with rows still queued, then back in: the first sync keeps the backup's copy, so the queued edit is
  // gone. That is why sign-out pushes first and warns about what is still pending.
  it('replaces an edit that never reached the account when the phone signs in again', async () => {
    const account = memoryServer()
    await device.writeRows([exercise('squat', 'Squat')])
    await syncFor(device, account).sync()
    await device.writeRows([exercise('squat', 'Front squat', LATER)])
    expect(await outboxOf(device)).toHaveLength(1)

    await restartFirstSync(device)
    await syncFor(device, account).sync()
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Squat')
    expect(nameOf(account.rows.get('exercises:squat'))).toBe('Squat')
    expect(await outboxOf(device)).toEqual([])
  })
})
