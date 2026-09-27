import { fetchJimbroApi, getCloudBackupConfig, getLastBackupDate } from '../db/cloudBackup'
import { storage, type OutboxEntry } from '../db/storage'
import { planBootstrap, rowKey } from './bootstrap'
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

const pushChunk = async (entries: OutboxEntry[]) => {
  const loaded = await storage.readOutboxRows(entries)
  if (loaded.rows.length === 0) {
    await storage.deleteOutboxIfUnchanged(loaded.missing)
    const again = await storage.readOutbox(1)
    const head = entries[0]
    return Boolean(again[0] && head && (again[0].key !== head.key || again[0].seq !== head.seq))
  }
  const response = await fetchJimbroApi('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: loaded.rows })
  })
  await assertOk(response)
  await storage.deleteOutboxIfUnchanged(loaded.sent)
  return true
}

const pushOutbox = async () => {
  for (;;) {
    const entries = await storage.readOutbox(PUSH_CHUNK)
    if (entries.length === 0) return
    const progressed = await pushChunk(entries)
    if (!progressed) return
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
  await pushOutbox()
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
  if (cursor === 0) await firstSync()
  else await steadySync(cursor)
}

let running = false
let rerun = false
let tail: Promise<void> = Promise.resolve()

export const sync = (): Promise<void> => {
  if (!getCloudBackupConfig() || !navigator.onLine) return Promise.resolve()
  if (running) {
    rerun = true
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
      console.error('sync failed', error)
    } finally {
      running = false
      window.dispatchEvent(new CustomEvent('jimbro:sync-settled'))
    }
  })()
  void tail.then(() => {
    if (!rerun) return
    rerun = false
    void sync()
  })
  return tail
}
