import { AuthEnv, resolveUserId } from './auth'
import {
  countStatements,
  countsOf,
  exportFromRows,
  flattenRowSet,
  loadRowSet,
  parseExportFile,
  parsePushBody,
  pullRows,
  rowsFromExport,
  upsertRows,
  ROW_LIMIT,
  type ImportMarker
} from './rows'
const ALLOWED_ORIGINS = new Set(['https://jimbro.nop33.com', 'http://localhost:5173'])

const withCors = (request: Request, response: Response) => {
  const origin = request.headers.get('Origin')
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

interface Env extends AuthEnv {
  BACKUP_BUCKET: R2Bucket
  jimbro: D1Database
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }))

    const response = await handleRequest(request, env)
    return withCors(request, response)
  }
} satisfies ExportedHandler<Env>

const finish = (request: Request, response: Response) => {
  if (request.headers.get('x-d1-count') !== '1' || response.headers.has('x-d1-statements')) return response
  const headers = new Headers(response.headers)
  headers.set('x-d1-statements', '0')
  headers.set('x-d1-batches', '0')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const json = (request: Request, body: unknown, status: number, counted?: { statements: number; batches: number }) => {
  const response = Response.json(body, { status })
  if (!counted || request.headers.get('x-d1-count') !== '1') return response
  const headers = new Headers(response.headers)
  headers.set('x-d1-statements', String(counted.statements))
  headers.set('x-d1-batches', String(counted.batches))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const countedHeaders = (counted: { statements: () => number; batches: () => number }) => ({
  statements: counted.statements(),
  batches: counted.batches()
})

const latestKey = (userId: string) => `users/${userId}/latest.json`

const markerKey = (userId: string) => `users/${userId}/import.json`

const importRequired = async (bucket: R2Bucket, userId: string) => {
  const [latest, marker] = await Promise.all([bucket.head(latestKey(userId)), bucket.head(markerKey(userId))])
  return latest !== null && marker === null
}

const readImportedExportDate = async (bucket: R2Bucket, userId: string) => {
  const object = await bucket.get(markerKey(userId))
  if (!object) return null
  const marker = await object.json<Partial<ImportMarker>>()
  return typeof marker.exportDate === 'string' ? marker.exportDate : null
}

const parseCursor = (value: string | null) => {
  if (value === null || value === '') return 0
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}

const parseLimit = (value: string | null) => {
  if (value === null || value === '') return ROW_LIMIT
  if (!/^\d+$/.test(value)) return null
  const limit = Number(value)
  if (limit < 1) return null
  return Math.min(limit, ROW_LIMIT)
}

const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const path = url.pathname

  // Auth: Resolve userId from bearer token
  const userId = resolveUserId(request.headers.get('Authorization'), env)

  if (path.startsWith('/api/')) {
    if (!userId) return finish(request, Response.json({ error: 'unauthorized' }, { status: 401 }))

    if (path === '/api/ping' && request.method === 'GET') return Response.json({ ok: true, userId })
    if (path === '/api/import-r2' && request.method === 'POST') return handleImport(request, env, userId)
    if (path === '/api/push' && request.method === 'POST') return handlePush(request, env, userId)
    if (path === '/api/pull' && request.method === 'GET') return handlePull(request, env, userId, url)
    if (path === '/api/export' && request.method === 'GET') return handleExport(request, env, userId)
  }

  return Response.json({ error: 'not found' }, { status: 404 })
}

const handleImport = async (request: Request, env: Env, userId: string) => {
  if (await env.BACKUP_BUCKET.head(markerKey(userId))) return json(request, { error: 'already_imported' }, 409)

  const latest = await env.BACKUP_BUCKET.get(latestKey(userId))
  if (!latest) return json(request, { error: 'not_found' }, 404)

  let data: unknown
  try {
    data = await latest.json()
  } catch {
    return json(request, { error: 'invalid_export' }, 400)
  }

  const parsed = parseExportFile(data)
  if (!parsed) return json(request, { error: 'invalid_export' }, 400)

  const rowSet = rowsFromExport(parsed)
  const counted = countStatements(env.jimbro)
  const revision = await upsertRows(counted.db, userId, flattenRowSet(rowSet))
  const counts = countsOf(rowSet)
  const marker: ImportMarker = {
    exportDate: parsed.exportDate,
    importedAt: new Date().toISOString(),
    counts
  }
  await env.BACKUP_BUCKET.put(markerKey(userId), JSON.stringify(marker))
  return json(request, { counts, revision }, 200, countedHeaders(counted))
}

const handlePush = async (request: Request, env: Env, userId: string) => {
  let data: unknown
  try {
    data = await request.json()
  } catch {
    return json(request, { error: 'invalid_json' }, 400)
  }

  const parsed = parsePushBody(data)
  if (!parsed.ok) {
    if ('error' in parsed) return json(request, { error: parsed.error }, 400)
    return json(request, { error: 'invalid_row', index: parsed.index }, 400)
  }

  if (await importRequired(env.BACKUP_BUCKET, userId)) return json(request, { error: 'import_required' }, 409)

  const counted = countStatements(env.jimbro)
  const revision = await upsertRows(counted.db, userId, parsed.rows)
  return json(request, { revision }, 200, countedHeaders(counted))
}

const handlePull = async (request: Request, env: Env, userId: string, url: URL) => {
  const cursor = parseCursor(url.searchParams.get('cursor'))
  const limit = parseLimit(url.searchParams.get('limit'))
  if (cursor === null) return json(request, { error: 'invalid_cursor' }, 400)
  if (limit === null) return json(request, { error: 'invalid_limit' }, 400)
  if (await importRequired(env.BACKUP_BUCKET, userId)) return json(request, { error: 'import_required' }, 409)

  const counted = countStatements(env.jimbro)
  const page = await pullRows(counted.db, userId, cursor, limit)
  const body: {
    rows: typeof page.rows
    cursor: number
    more: boolean
    importedExportDate?: string | null
  } = { rows: page.rows, cursor: page.cursor, more: page.more }
  if (cursor === 0) body.importedExportDate = await readImportedExportDate(env.BACKUP_BUCKET, userId)
  return json(request, body, 200, countedHeaders(counted))
}

const handleExport = async (request: Request, env: Env, userId: string) => {
  const importedExportDate = await readImportedExportDate(env.BACKUP_BUCKET, userId)
  const counted = countStatements(env.jimbro)
  const rowSet = await loadRowSet(counted.db, userId, 4, importedExportDate ?? new Date().toISOString())
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Content-Disposition': 'attachment; filename="jimbro-export.json"'
  })
  if (request.headers.get('x-d1-count') === '1') {
    headers.set('x-d1-statements', String(counted.statements()))
    headers.set('x-d1-batches', String(counted.batches()))
  }
  return new Response(JSON.stringify(exportFromRows(rowSet)), { status: 200, headers })
}
