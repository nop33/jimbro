import type { Storage } from '../db/storage'
import type { Row } from '../db/types'
import { planBootstrap, rowKey } from './bootstrap'
import { createOutbox, type PushLock } from './outbox'
import type { PageNotice } from './pageChannel'
import { commitFirstSync, readFirstSyncSnapshot, rowFromWire } from './pull'
import { getMeta } from './queue'
import type { SyncServer } from './server'

// What a sync needs from the page that runs it.
export interface SyncPage {
  // Tells the page.
  announce(notice: Extract<PageNotice, 'sync-settled'>): void
  // Records the time a sync succeeded, before its sync-settled.
  synced(at: string): void
  // Whether the page is going away. Leaving aborts the sync's requests, so a sync that fails then resolves quietly.
  leaving(): boolean
}

// Each user runs the app on one device, and only this device writes to the server, so the server holds a backup of
// this database. A sync backs it up and, on a database that has never synced, restores it.
export interface Sync {
  // While the database has never synced, after a fresh install or a reset, runs a first sync, which restores: pull
  // everything, plan each row against the local copy, commit the plan, push. After that a sync only pushes the outbox
  // and pulls nothing.
  // Announces sync-settled each time it ends, also when the server is unreachable and it sent nothing. A call during a
  // running sync resolves with it and, unless `again` is false, queues one more run after it.
  sync: (options?: { again?: boolean }) => Promise<void>
}

export const createSync = (deps: { storage: Storage; server: SyncServer; lock: PushLock; page: SyncPage }): Sync => {
  const { storage, server, page } = deps
  const outbox = createOutbox({ storage, lock: deps.lock })

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
    await outbox.drain(server.push)
  }

  const runSync = async () => {
    const cursor = await getMeta(storage, 'cursor')
    const bootstrapped = await getMeta(storage, 'bootstrapped')
    if (cursor === 0 && bootstrapped === 0) await firstSync()
    else await outbox.drain(server.push)
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
