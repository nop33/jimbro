import type { Storage } from '../db/storage'
import type { Row } from '../db/types'
import { planBootstrap, rowKey } from './bootstrap'
import { createOutbox, type PushLock } from './outbox'
import type { PageNotice } from './pageChannel'
import { commitFirstSync, commitPullPage, readFirstSyncSnapshot, rowFromWire } from './pull'
import { getMeta } from './queue'
import type { SyncServer } from './server'

// What a sync needs from the page that runs it.
export interface SyncPage {
  // The workout session the page shows, or null. A pull that changes it, its header or a set, announces
  // open-session-pulled.
  openSessionId(): string | null
  // Tells this tab and the other tabs.
  announce(notice: Extract<PageNotice, 'sync-settled' | 'open-session-pulled'>): void
  // Records the time a sync succeeded, before its sync-settled.
  synced(at: string): void
  // Whether the page is going away. Leaving aborts the sync's requests, so a sync that fails then resolves quietly.
  leaving(): boolean
}

export interface Sync {
  // While the database has never synced, runs a first sync: pull everything, plan each row against the local copy,
  // commit the plan, push. After that, runs a steady sync: push the outbox, then pull pages from the cursor. Rows that
  // still wait in the outbox, and rows equal to the stored copy, are not pulled over.
  // Announces sync-settled each time it ends, also when the server is unreachable and it sent nothing. A call during a
  // running sync resolves with it and, unless `again` is false, queues one more run after it.
  sync: (options?: { again?: boolean }) => Promise<void>
}

export const createSync = (deps: { storage: Storage; server: SyncServer; lock: PushLock; page: SyncPage }): Sync => {
  const { storage, server, page } = deps
  const outbox = createOutbox({ storage, lock: deps.lock })

  const notifyOpenSession = (rows: readonly Row[]) => {
    const sessionId = page.openSessionId()
    if (!sessionId) return
    const touched = rows.some((row) => {
      if (row.table === 'sessions') return row.row.id === sessionId
      if (row.table === 'sets') return row.row.sessionId === sessionId
      return false
    })
    if (touched) page.announce('open-session-pulled')
  }

  const firstSync = async () => {
    const snapshot = await readFirstSyncSnapshot(storage)
    const pulled: Row[] = []
    let cursor = 0
    let more = true
    while (more) {
      const next = await server.pull(cursor)
      for (const entry of next.rows) pulled.push(rowFromWire(entry))
      cursor = next.cursor
      more = next.more
      if (next.rows.length === 0) break
    }

    const actions = planBootstrap(snapshot.rows, pulled)
    const pulledByKey = new Map(pulled.map((row) => [rowKey(row), row]))
    await commitFirstSync(storage, { seqAtStart: snapshot.seq, cursor, actions, pulledByKey })
    notifyOpenSession(pulled)
    await outbox.drain(server.push)
  }

  const steadySync = async (start: number) => {
    await outbox.drain(server.push)
    let cursor = start
    let more = true
    while (more) {
      const next = await server.pull(cursor)
      notifyOpenSession(await commitPullPage(storage, next.rows, next.cursor))
      cursor = next.cursor
      more = next.more
      if (next.rows.length === 0) break
    }
  }

  const runSync = async () => {
    const cursor = await getMeta(storage, 'cursor')
    const bootstrapped = await getMeta(storage, 'bootstrapped')
    if (cursor === 0 && bootstrapped === 0) await firstSync()
    else await steadySync(cursor)
  }

  let running = false
  let rerun = false
  let tail: Promise<void> = Promise.resolve()

  const sync: Sync['sync'] = (options) => {
    if (!server.reachable()) {
      page.announce('sync-settled')
      return Promise.resolve()
    }
    if (running) {
      if (options?.again !== false) rerun = true
      return tail
    }
    running = true
    tail = (async () => {
      try {
        await runSync()
        page.synced(new Date().toISOString())
      } catch (error) {
        if (page.leaving()) return
        console.error('sync failed', error)
        throw error
      } finally {
        running = false
        page.announce('sync-settled')
      }
    })()
    const follow = () => {
      if (!rerun) return
      rerun = false
      void sync().catch(() => undefined)
    }
    void tail.then(follow, follow)
    return tail
  }

  return { sync }
}
