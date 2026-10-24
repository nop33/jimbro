import type { Row } from '../db/types'
import type { PushRows } from './outbox'

export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.jimbro.nop33.com'

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

// A request the worker refused, with the error it answered, such as row_limit, unauthorized or invalid_challenge, or
// the status.
export class ServerError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`request failed: ${status}${code === String(status) ? '' : ` ${code}`}`)
    this.status = status
    this.code = code
  }
}

// Sends one request to the worker, with the token when it is given, and resolves to the JSON it answered. Throws a
// ServerError when the worker refused it.
export const requestJson = async (
  path: string,
  options: { method?: 'GET' | 'POST'; token?: string; body?: unknown } = {}
): Promise<unknown> => {
  const headers = new Headers()
  if (options.token !== undefined) headers.set('Authorization', `Bearer ${options.token}`)
  const init: RequestInit = { method: options.method ?? 'GET', headers }
  if (options.method === 'POST') {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(options.body ?? {})
  }
  const response = await fetch(`${API_BASE}${path}`, init)
  if (response.ok) return (await response.json()) as unknown
  let code = String(response.status)
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    // The body was not JSON, so the status stands.
  }
  throw new ServerError(response.status, code)
}

const revisionOf = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('revision' in body)) return null
  return typeof body.revision === 'number' ? body.revision : null
}

// The worker's /api/push and /api/pull for one account's token. It is reachable while the browser is online.
export const httpServer = ({ token }: { token: string }): SyncServer => ({
  reachable: () => navigator.onLine,
  push: async (rows) => revisionOf(await requestJson('/api/push', { method: 'POST', token, body: { rows } })),
  pull: async (cursor) => (await requestJson(`/api/pull?cursor=${cursor}&limit=${PULL_LIMIT}`, { token })) as PullPage
})
