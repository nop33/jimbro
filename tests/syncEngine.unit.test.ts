import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import { Storage } from '../src/db/storage'
import { getMeta, type OutboxEntry } from '../src/sync/queue'
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
})

describe('first sync', () => {
  it('pulls every page, stores the server rows and moves the cursor to the last revision', async () => {
    const server = memoryServer({ pageSize: 2 })
    server.seed(['a', 'b', 'c', 'd', 'e'].map((id) => exercise(id, id)))
    const page = testPage()
    await syncFor(device, server, page).sync()
    expect(server.pulls).toEqual([0, 2, 4])
    expect((await device.getAll(OBJECT_STORES.EXERCISES)).length).toBe(5)
    expect(await getMeta(device, 'cursor')).toBe(5)
    expect(server.received).toEqual([])
    expect(page.notices).toEqual(['sync-settled'])
    expect(page.synced).toHaveLength(1)
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

  it('marks an empty database on an empty server bootstrapped, so the next sync pushes before it pulls', async () => {
    const server = memoryServer()
    const sync = syncFor(device, server)
    await sync.sync()
    expect(await getMeta(device, 'bootstrapped')).toBe(1)
    expect(await getMeta(device, 'cursor')).toBe(0)

    // A first sync would keep the server's copy. A steady sync pushes this device's edit first.
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

  it('announces open-session-pulled when it pulls the open session', async () => {
    const server = memoryServer()
    server.seed([header('open', ['a'])])
    const page = testPage('open')
    await syncFor(device, server, page).sync()
    expect(page.notices).toEqual(['open-session-pulled', 'sync-settled'])
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

    const cleanServer = memoryServer({ pageSize: 2 })
    cleanServer.seed(serverRows)
    const clean = await freshStorage()
    await clean.writeRows(localRows)
    await syncFor(clean, cleanServer).sync()

    expect(await localState(device)).toEqual(await localState(clean))
    expect(await getMeta(device, 'cursor')).toBe(await getMeta(clean, 'cursor'))
    expect(Object.fromEntries(crashServer.rows)).toEqual(Object.fromEntries(cleanServer.rows))
  })
})

describe('steady sync', () => {
  it('pushes the outbox, then pulls pages from the cursor', async () => {
    const server = memoryServer({ pageSize: 2 })
    server.seed([exercise('squat', 'Squat')])
    const calls: string[] = []
    const logged: SyncServer = {
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
    const sync = syncFor(device, logged)
    await sync.sync()
    calls.length = 0

    server.seed([exercise('a', 'A'), exercise('b', 'B'), exercise('c', 'C')])
    await device.writeRows([exercise('bench', 'Bench')])
    await sync.sync()
    expect(calls).toEqual(['push', 'pull 1', 'pull 3'])
    expect(byId(await device.getAll<ExerciseRow>(OBJECT_STORES.EXERCISES)).map((row) => row.id)).toEqual([
      'a',
      'b',
      'bench',
      'c',
      'squat'
    ])
    expect(await getMeta(device, 'cursor')).toBe(5)
  })

  it('does not pull over a row edited while it pulls, and pushes the edit next', async () => {
    const server = memoryServer()
    server.seed([exercise('squat', 'Squat')])
    await syncFor(device, server).sync()

    server.seed([exercise('squat', 'Server squat', LATER)])
    const editing = beforeFirstPull(server, () =>
      device.writeRows([exercise('squat', 'Phone squat', '2026-10-01T12:00:02.000Z')])
    )
    await syncFor(device, editing).sync()
    expect(nameOf(await device.get<ExerciseRow>(OBJECT_STORES.EXERCISES, 'squat'))).toBe('Phone squat')
    expect((await outboxOf(device)).map((entry) => entry.key)).toEqual(['exercises:squat'])

    await syncFor(device, server).sync()
    expect(nameOf(server.rows.get('exercises:squat'))).toBe('Phone squat')
    expect(await outboxOf(device)).toEqual([])
  })

  it('announces open-session-pulled only for a pulled change to the open session', async () => {
    const server = memoryServer()
    const page = testPage('open')
    const sync = syncFor(device, server, page)
    await sync.sync()

    const noticesOf = async (run: () => Promise<void>) => {
      page.notices.length = 0
      await run()
      await sync.sync()
      return [...page.notices]
    }
    expect(await noticesOf(async () => void server.seed([set('other', 'a', 10)]))).toEqual(['sync-settled'])
    expect(await noticesOf(async () => void server.seed([set('open', 'a', 10)]))).toEqual([
      'open-session-pulled',
      'sync-settled'
    ])
    expect(await noticesOf(async () => void server.seed([header('open', ['a'])]))).toEqual([
      'open-session-pulled',
      'sync-settled'
    ])
    // The pull brings back the set this device just pushed, equal to the stored copy.
    expect(await noticesOf(() => device.writeRows([set('open', 'a', 20, LATER)]))).toEqual(['sync-settled'])
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
    expect(server.pulls).toEqual([0, 0])
  })

  it('queues no further run for a call that passes again: false', async () => {
    const server = memoryServer()
    const release = deferred()
    const gated: SyncServer = {
      ...server,
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
    await new Promise((resolve) => setTimeout(resolve))
    expect(page.notices).toEqual(['sync-settled'])
    expect(server.pulls).toEqual([0])
  })

  it('rejects, logs and settles when a request fails', async () => {
    const server = memoryServer()
    const failing: SyncServer = {
      ...server,
      pull: async () => {
        throw new Error('offline')
      }
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const page = testPage()
    await expect(syncFor(device, failing, page).sync()).rejects.toThrow('offline')
    expect(logged).toHaveBeenCalledWith('sync failed', expect.any(Error))
    expect(page.notices).toEqual(['sync-settled'])
    expect(page.synced).toEqual([])
  })

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
    expect(page.notices).toEqual(['sync-settled'])
  })
})
