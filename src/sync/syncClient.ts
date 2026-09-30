import { fetchJimbroApi, getCloudBackupConfig, getLastBackupDate } from '../db/cloudBackup'
import { storage } from '../db/storage'
import { planBootstrap, rowKey } from './bootstrap'
import { outbox, type PushRows } from './outbox'
import { announce } from './pageChannel'
import { clearImportRequired, markImportRequired, setLastSyncAt } from './status'
import { type Row } from './rows'

export class ImportRequiredError extends Error {
  constructor() {
    super('import_required')
    this.name = 'ImportRequiredError'
  }
}

interface PullPage {
  rows: Array<Row & { rev: number }>
  cursor: number
  more: boolean
  importedExportDate?: string | null
}

const assertOk = async (response: Response) => {
  if (response.status === 409) {
    const body: unknown = await response.json().catch(() => null)
    if (body && typeof body === 'object' && 'error' in body && body.error === 'import_required') {
      throw new ImportRequiredError()
    }
    throw new Error('sync request failed: 409')
  }
  if (!response.ok) throw new Error(`sync request failed: ${response.status}`)
}

const pullPage = async (cursor: number): Promise<PullPage> => {
  const response = await fetchJimbroApi(`/api/pull?cursor=${cursor}&limit=1000`)
  await assertOk(response)
  return (await response.json()) as PullPage
}

const bodyOf = (entry: Row & { rev: number }): Row => {
  switch (entry.table) {
    case 'exercises':
      return { table: 'exercises', row: entry.row }
    case 'programs':
      return { table: 'programs', row: entry.row }
    case 'sessions':
      return { table: 'sessions', row: entry.row }
    case 'sets':
      return { table: 'sets', row: entry.row }
  }
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
  await assertOk(response)
  return revisionOf(await response.json())
}

const firstSync = async () => {
  const snapshot = await storage.readFirstSyncSnapshot()
  const pulled: Row[] = []
  let cursor = 0
  let more = true
  let importedExportDate: string | null = null
  while (more) {
    const page = await pullPage(cursor)
    if (cursor === 0) importedExportDate = page.importedExportDate ?? null
    for (const entry of page.rows) pulled.push(bodyOf(entry))
    cursor = page.cursor
    more = page.more
    if (page.rows.length === 0) break
  }

  const lastDate = getLastBackupDate()
  const isSnapshotWriter = Boolean(lastDate && importedExportDate && lastDate >= importedExportDate)
  const actions = planBootstrap(snapshot.rows, pulled, isSnapshotWriter)
  const pulledByKey = new Map(pulled.map((row) => [rowKey(row), row]))
  await storage.commitFirstSync({
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
    notifyOpenSession(await storage.commitPullPage(page.rows, page.cursor))
    cursor = page.cursor
    more = page.more
    if (page.rows.length === 0) break
  }
}

const runSync = async () => {
  const cursor = await storage.getMeta('cursor')
  const bootstrapped = await storage.getMeta('bootstrapped')
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
      clearImportRequired()
      setLastSyncAt(new Date().toISOString())
    } catch (error) {
      if (error instanceof ImportRequiredError) {
        markImportRequired()
        return
      }
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
