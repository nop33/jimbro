import { fetchJimbroApi, getCloudBackupConfig } from '../db/cloudBackup'
import { storage } from '../db/storage'
import { planBootstrap, rowKey } from './bootstrap'
import { outbox, type PushRows } from './outbox'
import { announce } from './pageChannel'
import { commitFirstSync, commitPullPage, readFirstSyncSnapshot, rowFromWire } from './pull'
import { getMeta } from './queue'
import { setLastSyncAt } from './status'
import type { Row } from '../db/types'

interface PullPage {
  rows: Array<Row & { rev: number }>
  cursor: number
  more: boolean
}

const assertOk = (response: Response) => {
  if (!response.ok) throw new Error(`sync request failed: ${response.status}`)
}

const pullPage = async (cursor: number): Promise<PullPage> => {
  const response = await fetchJimbroApi(`/api/pull?cursor=${cursor}&limit=1000`)
  assertOk(response)
  return (await response.json()) as PullPage
}

const notifyOpenSession = (rows: readonly Row[]) => {
  const sessionId = new URLSearchParams(window.location.search).get('id')
  if (!sessionId) return
  const touched = rows.some((row) => {
    if (row.table === 'sessions') return row.row.id === sessionId
    if (row.table === 'sets') return row.row.sessionId === sessionId
    return false
  })
  if (!touched) return
  window.dispatchEvent(new CustomEvent('jimbro:open-session-pulled', { detail: { sessionId } }))
}

const revisionOf = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('revision' in body)) return null
  return typeof body.revision === 'number' ? body.revision : null
}

const pushToServer: PushRows = async (rows) => {
  const response = await fetchJimbroApi('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  })
  assertOk(response)
  return revisionOf(await response.json())
}

const firstSync = async () => {
  const snapshot = await readFirstSyncSnapshot(storage)
  const pulled: Row[] = []
  let cursor = 0
  let more = true
  while (more) {
    const page = await pullPage(cursor)
    for (const entry of page.rows) pulled.push(rowFromWire(entry))
    cursor = page.cursor
    more = page.more
    if (page.rows.length === 0) break
  }

  const actions = planBootstrap(snapshot.rows, pulled)
  const pulledByKey = new Map(pulled.map((row) => [rowKey(row), row]))
  await commitFirstSync(storage, {
    seqAtStart: snapshot.seq,
    cursor,
    actions,
    pulledByKey
  })
  notifyOpenSession(pulled)
  await outbox.drain(pushToServer)
}

const steadySync = async (start: number) => {
  await outbox.drain(pushToServer)
  let cursor = start
  let more = true
  while (more) {
    const page = await pullPage(cursor)
    notifyOpenSession(await commitPullPage(storage, page.rows, page.cursor))
    cursor = page.cursor
    more = page.more
    if (page.rows.length === 0) break
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
let leaving = false
let tail: Promise<void> = Promise.resolve()

window.addEventListener('pagehide', () => {
  leaving = true
})

const settle = () => {
  window.dispatchEvent(new CustomEvent('jimbro:sync-settled'))
  announce('sync-settled')
}

export const sync = (options?: { again?: boolean }): Promise<void> => {
  if (!getCloudBackupConfig() || !navigator.onLine) {
    settle()
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
      setLastSyncAt(new Date().toISOString())
    } catch (error) {
      if (leaving) return
      console.error('sync failed', error)
      throw error
    } finally {
      running = false
      settle()
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
