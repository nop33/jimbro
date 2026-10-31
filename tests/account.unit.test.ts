import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import { Storage } from '../src/db/storage'
import { createAccounts, type Account, type KeyValue } from '../src/sync/account'
import { getMeta, type OutboxEntry } from '../src/sync/queue'
import { ServerError, type SyncServer } from '../src/sync/server'
import { createSync } from '../src/sync/syncEngine'
import type { Row } from '../src/db/types'
import { memoryServer, sharedLock, testPage } from './memoryServer'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const AT = '2026-10-01T12:00:00.000Z'

const exercise = (id: string, name: string): Row => ({
  table: 'exercises',
  row: {
    id,
    name,
    kind: 'lifting',
    preset: 'lifting',
    targetSets: 3,
    defaults: { reps: 5 },
    isDeleted: false,
    updatedAt: AT
  }
})

const A: Account = { userId: 'a', token: 'token-a', method: 'token' }
const B: Account = { userId: 'b', token: 'token-b', method: 'token' }

// localStorage as a Map, which a test can also read and write behind the account's back.
const memoryLocal = () => {
  const values = new Map<string, string>()
  const local: KeyValue = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    }
  }
  return { values, local }
}

const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// One device: its database, its saved account and its sync, with one in-memory server per account.
const deviceWith = async (servers: Record<string, SyncServer>) => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const storage = new Storage()
  await storage.connection()
  const { values, local } = memoryLocal()
  const { lock } = sharedLock()
  const accounts = createAccounts({ storage, lock, local: () => local })
  const { page } = testPage()
  const { sync } = createSync({ storage, accounts, server: (account) => servers[account.userId], lock, page })
  return { storage, values, accounts, sync }
}

const keysOf = (server: ReturnType<typeof memoryServer>) => [...server.rows.keys()].sort()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the saved account', () => {
  let device: Awaited<ReturnType<typeof deviceWith>>

  beforeEach(async () => {
    device = await deviceWith({})
  })

  it('reads credentials saved before passkeys as a token, and ignores ones it cannot read', () => {
    device.values.set('jimbro.cloudBackup', JSON.stringify({ userId: 'someone', token: 'secret' }))
    expect(device.accounts.current()).toEqual({ userId: 'someone', token: 'secret', method: 'token' })
    device.values.set('jimbro.cloudBackup', JSON.stringify({ userId: '', token: 'secret' }))
    expect(device.accounts.current()).toBeNull()
    device.values.set('jimbro.cloudBackup', '{')
    expect(device.accounts.current()).toBeNull()
  })

  it('keeps the sync status until the next sync succeeds, and a full account as a problem', () => {
    device.accounts.failed(new ServerError(413, 'row_limit'))
    device.accounts.failed(new ServerError(429, 'rate_limited'))
    expect(device.accounts.status()).toEqual({ lastSyncAt: null, problem: 'row_limit' })
    device.accounts.synced(AT)
    expect(device.accounts.status()).toEqual({ lastSyncAt: AT, problem: null })
  })

  it('switches by restarting the first sync and forgetting the status of the account before', async () => {
    await device.accounts.switchTo(A)
    await device.storage.writeRows([exercise('squat', 'Squat')])
    device.accounts.synced(AT)
    device.accounts.failed(new ServerError(413, 'row_limit'))
    const db = await device.storage.connection()
    await new Promise<void>((resolve) => {
      const tx = db.transaction([OBJECT_STORES.META, OBJECT_STORES.OUTBOX], 'readwrite')
      tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: 7 })
      const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
      outbox.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
        if (cursor) cursor.update({ ...(cursor.value as OutboxEntry), inflightSeq: 1 })
      }
      tx.oncomplete = () => resolve()
    })

    await device.accounts.switchTo({ ...B, method: 'passkey' })

    expect(device.accounts.current()).toEqual({ ...B, method: 'passkey' })
    expect(device.accounts.status()).toEqual({ lastSyncAt: null, problem: null })
    expect(await getMeta(device.storage, 'cursor')).toBe(0)
    expect(await getMeta(device.storage, 'bootstrapped')).toBe(0)
    const [entry] = await device.storage.getAll<OutboxEntry>(OBJECT_STORES.OUTBOX)
    expect(entry.inflightSeq).toBeUndefined()
  })

  it('signs out by forgetting the account and its status, and remembers it until the next switch', async () => {
    await device.accounts.switchTo(A)
    device.accounts.synced(AT)
    await device.accounts.signOut()
    expect(device.accounts.current()).toBeNull()
    expect(device.accounts.signedOut()).toBe(true)
    expect(device.accounts.status()).toEqual({ lastSyncAt: null, problem: null })

    await device.accounts.switchTo(A)
    expect(device.accounts.signedOut()).toBe(false)
  })

  it('forgets a passkey account the worker no longer knows as moved, and keeps a token account', async () => {
    await device.accounts.switchTo(A)
    device.accounts.failed(new ServerError(401, 'unauthorized'))
    expect(device.accounts.current()).toEqual(A)

    await device.accounts.switchTo({ ...B, method: 'passkey' })
    device.accounts.synced(AT)
    device.accounts.failed(new ServerError(401, 'unauthorized'))
    expect(device.accounts.current()).toBeNull()
    expect(device.accounts.signedOut()).toBe(true)
    expect(device.accounts.status()).toEqual({ lastSyncAt: null, problem: 'moved' })
  })
})

describe('a sync with the saved account', () => {
  it('backs a device that synced with one account up to the token typed for another, and restores it', async () => {
    const accountA = memoryServer()
    const accountB = memoryServer()
    accountB.seed([exercise('deadlift', 'Deadlift')])
    const device = await deviceWith({ a: accountA, b: accountB })
    await device.accounts.switchTo(A)
    await device.storage.writeRows([exercise('squat', 'Squat')])
    await device.sync()
    expect(keysOf(accountA)).toEqual(['exercises:squat'])

    await device.accounts.switchTo(B)
    await device.sync()

    expect(keysOf(accountB)).toEqual(['exercises:deadlift', 'exercises:squat'])
    expect((await device.storage.getAll<{ id: string }>(OBJECT_STORES.EXERCISES)).map((row) => row.id).sort()).toEqual([
      'deadlift',
      'squat'
    ])
    expect(accountA.received).toHaveLength(1)
  })

  it('does nothing without an account', async () => {
    const server = memoryServer()
    const device = await deviceWith({ a: server })
    await device.storage.writeRows([exercise('squat', 'Squat')])
    await device.sync()
    await device.accounts.switchTo(A)
    await device.accounts.signOut()
    await device.sync()
    expect(server.pulls).toEqual([])
    expect(server.received).toEqual([])
  })

  it('talks to the account it started with to the end, and a switch waits for it', async () => {
    const accountA = memoryServer()
    const accountB = memoryServer()
    const release = deferred()
    const pulled = deferred()
    const gatedA: SyncServer = {
      ...accountA,
      async pull(cursor) {
        pulled.resolve()
        await release.promise
        return accountA.pull(cursor)
      }
    }
    const device = await deviceWith({ a: gatedA, b: accountB })
    await device.accounts.switchTo(A)
    await device.storage.writeRows([exercise('squat', 'Squat')])

    const running = device.sync()
    await pulled.promise
    let switched = false
    const switching = device.accounts.switchTo(B).then(() => {
      switched = true
    })
    // A task that starts during the switch waits for it, and gets the new account.
    const during = device.accounts.use(async (account) => account.userId)
    await new Promise((resolve) => setTimeout(resolve))
    expect(switched).toBe(false)

    release.resolve()
    await running
    await switching
    expect(await during).toBe('b')
    await device.sync()

    expect(keysOf(accountA)).toEqual(['exercises:squat'])
    expect(accountB.pulls).toEqual([0])
    expect(keysOf(accountB)).toEqual(['exercises:squat'])
    expect(await getMeta(device.storage, 'cursor')).toBeGreaterThan(0)
  })
})
