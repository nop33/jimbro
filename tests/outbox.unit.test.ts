import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OBJECT_STORES } from '../src/db/constants'
import { Storage, type OutboxEntry } from '../src/db/storage'
import { rowKey } from '../src/sync/bootstrap'
import { createOutbox, type PushLock, type PushRows } from '../src/sync/outbox'
import { canonical, type Row, type SetRow } from '../src/sync/rows'

// storage.ts announces writes on window. Node has no window, so an EventTarget stands in.
vi.stubGlobal('window', new EventTarget())

const set = (weight: number, id = 'race-set'): SetRow => ({
  id,
  sessionId: 'race-session',
  exerciseId: 'race-exercise',
  position: 0,
  set: { preset: 'lifting', reps: 5, weight },
  isDeleted: false,
  updatedAt: `2026-09-27T12:00:${String(weight % 60).padStart(2, '0')}.000Z`
})

const setRow = (weight: number, id?: string): Row => ({ table: 'sets', row: set(weight, id) })

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

// One Web Lock shared by every page in a test, granted in request order.
const sharedLock = () => {
  let tail: Promise<unknown> = Promise.resolve()
  let requests = 0
  const lock: PushLock = (task) => {
    requests += 1
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  return { lock, requests: () => requests }
}

// Like the worker: a changed body gets the user's next revision, an unchanged one keeps its own,
// and a push answers with the user's highest revision, 0 while the user has no rows.
const fakeServer = () => {
  const rows = new Map<string, Row>()
  const received: Row[][] = []
  let revision = 0
  return {
    rows,
    received,
    accept(batch: Row[]) {
      received.push(batch)
      for (const row of batch) {
        const stored = rows.get(rowKey(row))
        if (stored && canonical(stored.row) === canonical(row.row)) continue
        rows.set(rowKey(row), row)
        revision += 1
      }
      return revision
    }
  }
}

const outboxOf = (storage: Storage) => storage.getAll<OutboxEntry>(OBJECT_STORES.OUTBOX)

const entryFor = async (storage: Storage, row: Row) =>
  (await outboxOf(storage)).find((entry) => entry.key === rowKey(row))

const setMeta = async (storage: Storage, name: 'cursor' | 'bootstrapped', value: number) => {
  const db = await storage.connection()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([OBJECT_STORES.META], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OBJECT_STORES.META).put({ name, value })
  })
}

// A first sync on a server that still has `server`: the plan keeps the server copy.
const firstSyncKeepsServer = async (storage: Storage, server: Row) => {
  const snapshot = await storage.readFirstSyncSnapshot()
  await storage.commitFirstSync({
    seqAtStart: snapshot.seq,
    cursor: 0,
    actions: new Map([[rowKey(server), 'keepServer']]),
    pulledByKey: new Map([[rowKey(server), server]])
  })
}

let page: Storage

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  page = new Storage()
})

describe('Outbox.drain', () => {
  it('sends queued rows oldest first and empties the outbox', async () => {
    const server = fakeServer()
    await setMeta(page, 'cursor', 3)
    await page.writeRows([setRow(10, 'a')])
    await page.writeRows([setRow(20, 'b')])
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(server.received.map((batch) => batch.map((row) => row.row.id))).toEqual([['a', 'b']])
    expect(await outboxOf(page)).toEqual([])
    expect(await page.getMeta('cursor')).toBe(3)
    expect(await page.getMeta('bootstrapped')).toBe(0)
  })

  it('sends at most 500 rows per push', async () => {
    const server = fakeServer()
    await setMeta(page, 'cursor', 3)
    await page.writeRows(Array.from({ length: 501 }, (_, index) => setRow(index, `set-${index}`)))
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(server.received.map((batch) => batch.length)).toEqual([500, 1])
    expect(await outboxOf(page)).toEqual([])
  })

  it('drops an entry whose row is gone and sends the rest', async () => {
    const server = fakeServer()
    await setMeta(page, 'cursor', 3)
    await page.writeRows([setRow(10, 'gone')])
    await page.writeRows([setRow(20, 'kept')])
    const db = await page.connection()
    await new Promise<void>((resolve) => {
      const tx = db.transaction([OBJECT_STORES.SETS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.objectStore(OBJECT_STORES.SETS).delete('gone')
    })
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(server.received.map((batch) => batch.map((row) => row.row.id))).toEqual([['kept']])
    expect(await outboxOf(page)).toEqual([])
  })

  it('does not take the lock when nothing is queued', async () => {
    const shared = sharedLock()
    await setMeta(page, 'cursor', 3)
    const push = vi.fn<PushRows>()
    await createOutbox({ storage: page, lock: shared.lock }).drain(push)
    expect(shared.requests()).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })

  // Replaces the Playwright test 'an edit during a slow push stays in the outbox'.
  it('keeps an edit made while the push is on the wire and sends it next', async () => {
    const server = fakeServer()
    await setMeta(page, 'cursor', 3)
    await page.writeRows([setRow(40)])
    let edited = false
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => {
      if (!edited) {
        edited = true
        await page.writeRows([setRow(55)])
      }
      return server.accept(rows)
    })
    expect(server.received.map((batch) => weightOf(batch[0]))).toEqual([40, 55])
    expect(weightOf(await page.get<SetRow>('sets', 'race-set'))).toBe(55)
    expect(await outboxOf(page)).toEqual([])
  })

  it('keeps every row queued with its stamp when the push fails', async () => {
    await page.writeRows([setRow(10)])
    const failure = createOutbox({ storage: page, lock: sharedLock().lock }).drain(async () => {
      throw new Error('offline')
    })
    await expect(failure).rejects.toThrow('offline')
    const entry = await entryFor(page, setRow(10))
    expect(entry?.inflightSeq).toBe(entry?.seq)
    expect(entry?.inflightCanonical).toBe(canonical(set(10)))
    expect(await page.getMeta('bootstrapped')).toBe(0)
  })
})

describe('Outbox.drain on a database that has never synced', () => {
  it('moves the cursor to the revision of each ack', async () => {
    const server = fakeServer()
    await page.writeRows([setRow(10)])
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(await page.getMeta('cursor')).toBe(1)
    expect(await page.getMeta('bootstrapped')).toBe(0)
  })

  it('marks the database bootstrapped when the server reports no revision', async () => {
    await page.writeRows([setRow(10)])
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async () => null)
    expect(await page.getMeta('cursor')).toBe(0)
    expect(await page.getMeta('bootstrapped')).toBe(1)
    expect(await outboxOf(page)).toEqual([])
  })

  it('marks the database bootstrapped when the server answers revision 0', async () => {
    await page.writeRows([setRow(10)])
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async () => 0)
    expect(await page.getMeta('cursor')).toBe(0)
    expect(await page.getMeta('bootstrapped')).toBe(1)
    expect(await outboxOf(page)).toEqual([])
  })

  it('marks the database bootstrapped when nothing is queued', async () => {
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(vi.fn<PushRows>())
    expect(await page.getMeta('bootstrapped')).toBe(1)
  })

  // Replaces 'a stop after an empty-server push ack keeps the cursor and the next edit'.
  it('lands the cursor with the ack when the page stops right after it', async () => {
    const server = fakeServer()
    await page.writeRows([setRow(10)])
    const stopAfterTask: PushLock = async (task) => {
      await task()
      throw new Error('stop after outbox ack')
    }
    const stopped = createOutbox({ storage: page, lock: stopAfterTask }).drain(async (rows) => server.accept(rows))
    await expect(stopped).rejects.toThrow('stop after outbox ack')
    expect(await outboxOf(page)).toEqual([])
    expect(await page.getMeta('cursor')).toBe(1)

    await page.writeRows([setRow(99)])
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(99)
    expect(await page.getMeta('cursor')).toBe(1)
  })

  // Replaces 'a later edit survives when the empty-server push landed but the ack did not'.
  it('keeps a later edit through first sync when the push landed but its ack did not', async () => {
    const server = fakeServer()
    await page.writeRows([setRow(10)])
    const lost = createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => {
      server.accept(rows)
      throw new Error('ack lost')
    })
    await expect(lost).rejects.toThrow('ack lost')
    expect(await page.getMeta('cursor')).toBe(0)

    await page.writeRows([setRow(99)])
    const entry = await entryFor(page, setRow(99))
    expect(entry?.inflightCanonical).toBe(canonical(set(10)))
    expect(entry?.seq).toBeGreaterThan(entry?.inflightSeq ?? Infinity)

    await firstSyncKeepsServer(page, setRow(10))
    expect(weightOf(await page.get<SetRow>('sets', 'race-set'))).toBe(99)
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(99)
    expect(await outboxOf(page)).toEqual([])
  })

  // Replaces 'a later edit between the read and the inflight mark survives an unacked push'.
  // Take reads and stamps in one transaction, so the earliest an edit can land is right after it.
  it('keeps an edit made between take and the push through first sync when the ack is lost', async () => {
    const server = fakeServer()
    await page.writeRows([setRow(10)])
    const lost = createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => {
      await page.writeRows([setRow(99)])
      server.accept(rows)
      throw new Error('ack lost')
    })
    await expect(lost).rejects.toThrow('ack lost')
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(10)
    const entry = await entryFor(page, setRow(99))
    expect(entry?.inflightCanonical).toBe(canonical(set(10)))
    expect(entry?.seq).toBeGreaterThan(entry?.inflightSeq ?? Infinity)

    await firstSyncKeepsServer(page, setRow(10))
    expect(weightOf(await page.get<SetRow>('sets', 'race-set'))).toBe(99)
    await createOutbox({ storage: page, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(99)
  })
})

describe('Outbox.drain across pages', () => {
  // With the next test, replaces 'a second page does not post a body another page already
  // acknowledged' and 'a second page does not post after another page acks past the inflight
  // mark'. Both parked the first page after it read the outbox and before it posted. The lock now
  // covers take, push and ack, so either the second page waits for the first page's ack, or the
  // first page takes only after the second page's ack.
  it('makes a second page wait for the first page to ack, then sends only the newer body', async () => {
    const server = fakeServer()
    const shared = sharedLock()
    const other = new Storage()
    await setMeta(page, 'cursor', 3)
    await page.writeRows([setRow(40)])
    const parked = deferred()
    const release = deferred()
    const first = createOutbox({ storage: page, lock: shared.lock }).drain(async (rows) => {
      parked.resolve()
      await release.promise
      return server.accept(rows)
    })
    await parked.promise

    await other.writeRows([setRow(99)])
    const secondPush = vi.fn<PushRows>(async (rows) => server.accept(rows))
    const second = createOutbox({ storage: other, lock: shared.lock }).drain(secondPush)
    await vi.waitFor(() => expect(shared.requests()).toBe(2))
    expect(secondPush).not.toHaveBeenCalled()

    release.resolve()
    await Promise.all([first, second])
    expect(server.received.map((batch) => weightOf(batch[0]))).toEqual([40, 99])
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(99)
    expect(await outboxOf(page)).toEqual([])
  })

  it('sends nothing from a page that waited for the lock while another page acked its rows', async () => {
    const server = fakeServer()
    const other = new Storage()
    await setMeta(page, 'cursor', 3)
    await page.writeRows([setRow(40)])
    const granted = deferred()
    const requested = deferred()
    const waitingLock: PushLock = async (task) => {
      requested.resolve()
      await granted.promise
      return task()
    }
    const firstPush = vi.fn<PushRows>(async (rows) => server.accept(rows))
    const first = createOutbox({ storage: page, lock: waitingLock }).drain(firstPush)
    await requested.promise

    await other.writeRows([setRow(99)])
    await createOutbox({ storage: other, lock: sharedLock().lock }).drain(async (rows) => server.accept(rows))
    granted.resolve()
    await first
    expect(firstPush).not.toHaveBeenCalled()
    expect(server.received.map((batch) => weightOf(batch[0]))).toEqual([99])
    expect(await outboxOf(page)).toEqual([])
  })

  // Replaces 'a crashed second mark keeps the newer weight'.
  it('keeps the stamp of a landed push when a second page stamps a body that never left', async () => {
    const server = fakeServer()
    const shared = sharedLock()
    const other = new Storage()
    await page.writeRows([setRow(10)])
    const firstCrash = createOutbox({ storage: page, lock: shared.lock }).drain(async (rows) => {
      server.accept(rows)
      throw new Error('first page crashed')
    })
    await expect(firstCrash).rejects.toThrow('first page crashed')

    await other.writeRows([setRow(99)])
    const secondCrash = createOutbox({ storage: other, lock: shared.lock }).drain(async () => {
      throw new Error('second page crashed')
    })
    await expect(secondCrash).rejects.toThrow('second page crashed')
    const entry = await entryFor(page, setRow(99))
    expect(entry?.inflightCanonical).toBe(canonical(set(10)))

    await firstSyncKeepsServer(page, setRow(10))
    expect(weightOf(await page.get<SetRow>('sets', 'race-set'))).toBe(99)
    await createOutbox({ storage: page, lock: shared.lock }).drain(async (rows) => server.accept(rows))
    expect(weightOf(server.rows.get('sets:race-set'))).toBe(99)
  })
})
