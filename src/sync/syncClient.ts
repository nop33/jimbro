import { fetchJimbroApi, getCloudBackupConfig, getLastBackupDate } from '../db/cloudBackup'
import { storage, type OutboxEntry } from '../db/storage'
import { planBootstrap, rowKey } from './bootstrap'
import { announce } from './pageChannel'
import { clearImportRequired, markImportRequired, setLastSyncAt } from './status'
import type { Row } from './rows'

const PUSH_CHUNK = 500

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

const pushChunk = async (entries: OutboxEntry[], ackCursor: boolean) => {
  const loaded = await storage.readOutboxRows(entries)
  if (loaded.rows.length === 0) {
    await storage.deleteOutboxIfUnchanged(loaded.missing)
    const again = await storage.readOutbox(1)
    const head = entries[0]
    return {
      progressed: Boolean(again[0] && head && (again[0].key !== head.key || again[0].seq !== head.seq)),
      revision: null
    }
  }
  const response = await fetchJimbroApi('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: loaded.rows })
  })
  await assertOk(response)
  const revision = revisionOf(await response.json())
  const advance = ackCursor
    ? revision !== null && revision > 0
      ? { cursor: revision }
      : { bootstrapped: 1 }
    : undefined
  await storage.deleteOutboxIfUnchanged(loaded.sent, advance)
  return { progressed: true, revision }
}

const pushOutbox = async (ackCursor = false) => {
  let revision: number | null = null
  for (;;) {
    const entries = await storage.readOutbox(PUSH_CHUNK)
    if (entries.length === 0) return revision
    const pushed = await pushChunk(entries, ackCursor)
    if (pushed.revision !== null) revision = pushed.revision
    if (!pushed.progressed) return revision
  }
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
  const pushedRevision = await pushOutbox(cursor === 0)
  if (cursor !== 0) return
  if (pushedRevision !== null && pushedRevision > 0) return
  await storage.setMeta('bootstrapped', 1)
}

const steadySync = async (start: number) => {
  await pushOutbox()
  let cursor = start
  let more = true
  while (more) {
    const page = await pullPage(cursor)
    const rows = page.rows.map((entry) => bodyOf(entry))
    await storage.commitPullPage(page.rows, page.cursor)
    notifyOpenSession(rows)
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
    } finally {
      running = false
      settle()
    }
  })()
  void tail.then(() => {
    if (!rerun) return
    rerun = false
    void sync()
  })
  return tail
}
