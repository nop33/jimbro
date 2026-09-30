import { OBJECT_STORES } from '../db/constants'
import { storage, STORE_FOR_TABLE, type OutboxEntry, type Storage } from '../db/storage'
import { canonical, type Row, type RowTable } from './rows'

const PUSH_CHUNK = 500

// Sends rows to the server and resolves to the revision it reports, or null when it reports none.
// A rejection leaves every row queued.
export type PushRows = (rows: Row[]) => Promise<number | null>

// Runs a task while no other page runs one.
export type PushLock = <T>(task: () => Promise<T>) => Promise<T>

export interface Outbox {
  // Pushes every queued row in chunks. A row edited while its push was in flight stays queued.
  // While the database has never synced, each ack also records the sync in meta.
  drain(push: PushRows): Promise<void>
}

interface Taken {
  key: string
  seq: number
  row: Row
}

const rowOf = (table: RowTable, stored: IDBRequest): Row => {
  switch (table) {
    case 'exercises':
      return { table, row: stored.result }
    case 'programs':
      return { table, row: stored.result }
    case 'sessions':
      return { table, row: stored.result }
    case 'sets':
      return { table, row: stored.result }
  }
}

// Reads the oldest entries and their rows, drops entries whose row is gone and stamps the rest with
// the seq and body about to be sent, all in one transaction. A stamp already there stays: it records
// a push that may have reached the server without an ack, and first sync compares against it.
// Resolves to null when the outbox is empty, and to [] when every entry read pointed at a missing row.
const takeChunk = async (db: IDBDatabase, limit: number): Promise<Taken[] | null> => {
  const tx = db.transaction(
    [
      OBJECT_STORES.OUTBOX,
      OBJECT_STORES.EXERCISES,
      OBJECT_STORES.PROGRAMS,
      OBJECT_STORES.WORKOUT_SESSIONS,
      OBJECT_STORES.SETS
    ],
    'readwrite'
  )
  const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
  const read: { taken: Array<Taken | undefined> | null } = { taken: null }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('outbox take failed'))
    tx.onabort = () => reject(tx.error ?? new Error('outbox take aborted'))
    const request = outbox.getAll()
    request.onsuccess = () => {
      const entries = (request.result as OutboxEntry[]).sort((left, right) => left.seq - right.seq).slice(0, limit)
      if (entries.length === 0) return
      const taken = Array.from<Taken | undefined>({ length: entries.length })
      read.taken = taken
      entries.forEach((entry, index) => {
        const rowRequest = tx.objectStore(STORE_FOR_TABLE[entry.table]).get(entry.id)
        rowRequest.onsuccess = () => {
          if (rowRequest.result === undefined) {
            outbox.delete(entry.key)
            return
          }
          const row = rowOf(entry.table, rowRequest)
          taken[index] = { key: entry.key, seq: entry.seq, row }
          if (entry.inflightSeq === undefined || entry.inflightCanonical === undefined) {
            outbox.put({ ...entry, inflightSeq: entry.seq, inflightCanonical: canonical(row.row) })
          }
        }
      })
    }
  })
  if (!read.taken) return null
  return read.taken.filter((item): item is Taken => item !== undefined)
}

// Drops each sent entry whose seq is unchanged, so an edit made during the push stays queued.
// The meta advance lands in the same transaction: a stop between the two would leave a database
// that looks unsynced with nothing queued, and the next first sync could drop a later edit.
const acknowledge = async (
  db: IDBDatabase,
  sent: Taken[],
  advance: { name: 'cursor' | 'bootstrapped'; value: number } | null
) => {
  const tx = db.transaction(advance ? [OBJECT_STORES.OUTBOX, OBJECT_STORES.META] : [OBJECT_STORES.OUTBOX], 'readwrite')
  const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('outbox ack failed'))
    tx.onabort = () => reject(tx.error ?? new Error('outbox ack aborted'))
    if (advance) tx.objectStore(OBJECT_STORES.META).put(advance)
    for (const item of sent) {
      const request = outbox.get(item.key)
      request.onsuccess = () => {
        const current = request.result as OutboxEntry | undefined
        if (current && current.seq === item.seq) outbox.delete(item.key)
      }
    }
  })
}

const markBootstrapped = async (db: IDBDatabase) => {
  const tx = db.transaction([OBJECT_STORES.META], 'readwrite')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('outbox bootstrap mark failed'))
    tx.onabort = () => reject(tx.error ?? new Error('outbox bootstrap mark aborted'))
    tx.objectStore(OBJECT_STORES.META).put({ name: 'bootstrapped', value: 1 })
  })
}

// The lock covers take, push and ack of each chunk. No other page can then take, send or ack the
// same entries in between, so a page never posts a body another page already acked, and an ack
// always follows the push it belongs to. Chunks release the lock between them so pages interleave.
export const createOutbox = (deps: { storage: Storage; lock: PushLock }): Outbox => ({
  async drain(push) {
    const db = await deps.storage.connection()
    const unsynced = (await deps.storage.getMeta('cursor')) === 0 && (await deps.storage.getMeta('bootstrapped')) === 0
    let revision: number | null = null
    for (;;) {
      // Skip the lock when nothing is queued, so an idle page never waits on another page's push.
      if ((await deps.storage.count(OBJECT_STORES.OUTBOX)) === 0) break
      const pushed = await deps.lock(async () => {
        let taken = await takeChunk(db, PUSH_CHUNK)
        while (taken !== null && taken.length === 0) taken = await takeChunk(db, PUSH_CHUNK)
        if (taken === null) return null
        const result = await push(taken.map((item) => item.row))
        const advance = !unsynced
          ? null
          : result !== null && result > 0
            ? { name: 'cursor' as const, value: result }
            : { name: 'bootstrapped' as const, value: 1 }
        await acknowledge(db, taken, advance)
        return { revision: result }
      })
      if (!pushed) break
      if (pushed.revision !== null) revision = pushed.revision
    }
    if (unsynced && !(revision !== null && revision > 0)) await markBootstrapped(db)
  }
})

// Without navigator.locks the task runs unguarded. That happens outside a secure context, such as
// `vp dev` opened over a LAN IP, and in browsers without Web Locks. There two tabs can take and
// post the same entries at once, and a stale body can land after a newer one. Sync still runs,
// but the cross-tab guarantees in the comment on createOutbox do not hold.
const webLock =
  (name: string): PushLock =>
  (task) => {
    const locks = navigator.locks
    if (!locks) return task()
    // LockGrantedCallback types its return as T, so a promise callback is
    // Promise<Promise<T>>. The lock manager settles to the callback's value.
    return locks.request(name, task).then((settled) => settled)
  }

export const outbox = createOutbox({ storage, lock: webLock('jimbro:sync-push') })
