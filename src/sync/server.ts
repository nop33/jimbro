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

export const PULL_LIMIT = 1000

// A request the worker refused, with the error it answered, such as row_limit or rate_limited, or the status.
export class SyncRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`sync request failed: ${status}${code === String(status) ? '' : ` ${code}`}`)
    this.status = status
    this.code = code
  }
}

const assertOk = async (response: Response) => {
  if (response.ok) return
  let code = String(response.status)
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    // The body was not JSON, so the status stands.
  }
  throw new SyncRequestError(response.status, code)
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
    await assertOk(response)
    return revisionOf(await response.json())
  },
  async pull(cursor) {
    const response = await fetchJimbroApi(`/api/pull?cursor=${cursor}&limit=${PULL_LIMIT}`)
    await assertOk(response)
    return (await response.json()) as PullPage
  }
}
