import { rowKey } from '../src/sync/bootstrap'
import type { PushLock } from '../src/sync/outbox'
import { canonical } from '../src/sync/rows'
import type { SyncServer } from '../src/sync/server'
import type { SyncPage } from '../src/sync/syncEngine'
import type { Row } from '../src/db/types'

type StoredRow = Row & { rev: number }

// The in-memory adapter of the sync's server port, for one user. Like the worker: a changed body gets the user's next
// revision, an unchanged one keeps its own, a push answers with the user's highest revision, 0 while the user has no
// rows, and a pull returns the rows above the cursor in revision order, pageSize at a time.
export const memoryServer = (options: { pageSize?: number } = {}) => {
  const pageSize = options.pageSize ?? 1000
  const rows = new Map<string, StoredRow>()
  const received: Row[][] = []
  const pulls: number[] = []
  let revision = 0
  let reachable = true
  // Stores the rows as an earlier install's push would, and resolves to the revision a push answers with.
  const seed = (batch: Row[]) => {
    for (const row of batch) {
      const stored = rows.get(rowKey(row))
      if (stored && canonical(stored.row) === canonical(row.row)) continue
      revision += 1
      rows.set(rowKey(row), { ...structuredClone(row), rev: revision })
    }
    return revision
  }
  // Records the batch as this device's push, then stores it.
  const accept = (batch: Row[]) => {
    received.push(batch)
    return seed(batch)
  }
  const server: SyncServer = {
    reachable: () => reachable,
    push: async (batch) => accept(batch),
    async pull(cursor) {
      pulls.push(cursor)
      const above = [...rows.values()].filter((row) => row.rev > cursor).sort((left, right) => left.rev - right.rev)
      const page = above.slice(0, pageSize)
      return {
        rows: structuredClone(page),
        cursor: page.at(-1)?.rev ?? cursor,
        more: above.length > pageSize
      }
    }
  }
  return {
    ...server,
    rows,
    received,
    pulls,
    accept,
    seed,
    setReachable(value: boolean) {
      reachable = value
    }
  }
}

// One Web Lock shared by every page in a test, granted in request order.
export const sharedLock = () => {
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

// The page a sync runs on, recording what the sync tells it.
export const testPage = () => {
  const notices: string[] = []
  const synced: string[] = []
  const failures: unknown[] = []
  let leaving = false
  const page: SyncPage = {
    announce: (notice) => {
      notices.push(notice)
    },
    synced: (at) => {
      synced.push(at)
    },
    failed: (error) => {
      failures.push(error)
    },
    leaving: () => leaving
  }
  return {
    page,
    notices,
    synced,
    failures,
    leave() {
      leaving = true
    }
  }
}
