import { fetchJimbroApi, getCloudBackupConfig } from '../db/cloudBackup'
import type { Row } from '../db/types'
import type { PushRows } from './outbox'

// One page of a pull: the rows above the cursor asked for, in revision order, each with its revision, the cursor
// after them, and whether more rows remain above it.
export interface PullPage {
  rows: Array<Row & { rev: number }>
  cursor: number
  more: boolean
}

// The port the sync reaches the server through. The app passes httpServer, and the unit tests an in-memory server
// that keeps revisions the way the worker does.
export interface SyncServer {
  // Whether a sync can reach the server now. While it is false, a sync sends nothing and only settles.
  reachable(): boolean
  push: PushRows
  // Resolves to the page above cursor. A rejection leaves the database as the last committed page left it.
  pull(cursor: number): Promise<PullPage>
}

const PULL_LIMIT = 1000

const assertOk = (response: Response) => {
  if (!response.ok) throw new Error(`sync request failed: ${response.status}`)
}

const revisionOf = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('revision' in body)) return null
  return typeof body.revision === 'number' ? body.revision : null
}

// The worker's /api/push and /api/pull, with the saved credentials. It is reachable while credentials are saved and
// the browser is online.
export const httpServer: SyncServer = {
  reachable: () => getCloudBackupConfig() !== null && navigator.onLine,
  async push(rows) {
    const response = await fetchJimbroApi('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows })
    })
    assertOk(response)
    return revisionOf(await response.json())
  },
  async pull(cursor) {
    const response = await fetchJimbroApi(`/api/pull?cursor=${cursor}&limit=${PULL_LIMIT}`)
    assertOk(response)
    return (await response.json()) as PullPage
  }
}
