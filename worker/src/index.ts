import { AuthEnv, resolveUserId } from './auth'
import { handleMcp } from './mcp'
import { isAllowedOrigin, type OriginEnv } from './origins'
import {
  addPasskeyOptions,
  addPasskeyVerify,
  registerOptions,
  registerVerify,
  signInOptions,
  signInVerify,
  signOut
} from './passkeys'
import { exportFromRows } from '../../src/sync/rows'
import { countStatements, loadRowSet, parsePushBody, pullRows, upsertRows, ROW_LIMIT } from './rows'

const withCors = (request: Request, response: Response, env: Env) => {
  const origin = request.headers.get('Origin')
  if (!isAllowedOrigin(origin, env)) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

interface Env extends AuthEnv, OriginEnv {
  jimbro: D1Database
  // Limits the public passkey routes per client address. See wrangler.jsonc.
  AUTH_LIMITER: RateLimit
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }), env)

    const response = await handleRequest(request, env)
    return withCors(request, response, env)
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

// The public routes that sign up and sign in with a passkey. Anyone can call them, so each client address gets a
// budget of calls a minute.
const PUBLIC_AUTH_ROUTES = new Map<string, (request: Request, env: Env) => Promise<Response>>([
  ['/auth/register/options', registerOptions],
  ['/auth/register/verify', registerVerify],
  ['/auth/signin/options', signInOptions],
  ['/auth/signin/verify', signInVerify]
])

const handlePublicAuth = async (
  request: Request,
  env: Env,
  handle: (request: Request, env: Env) => Promise<Response>
) => {
  if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 })
  const client = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { success } = await env.AUTH_LIMITER.limit({ key: `auth:${client}` })
  if (!success) return Response.json({ error: 'rate_limited' }, { status: 429 })
  return handle(request, env)
}

const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const path = url.pathname

  const publicAuth = PUBLIC_AUTH_ROUTES.get(path)
  if (publicAuth) return handlePublicAuth(request, env, publicAuth)

  // Auth: Resolve userId from bearer token
  const userId = await resolveUserId(request.headers.get('Authorization'), env)

  if (path === '/mcp') {
    if (request.method !== 'POST') {
      return finish(request, Response.json({ error: 'method not allowed' }, { status: 405 }))
    }
    if (!userId) return finish(request, Response.json({ error: 'unauthorized' }, { status: 401 }))
    return finish(request, await handleMcp(request, env.jimbro, userId))
  }

  if (path.startsWith('/api/')) {
    if (!userId) return finish(request, Response.json({ error: 'unauthorized' }, { status: 401 }))

    if (path === '/api/ping' && request.method === 'GET') return Response.json({ ok: true, userId })
    if (path === '/api/push' && request.method === 'POST') return handlePush(request, env, userId)
    if (path === '/api/pull' && request.method === 'GET') return handlePull(request, env, userId, url)
    if (path === '/api/export' && request.method === 'GET') return handleExport(request, env, userId)
    if (path === '/api/passkeys/options' && request.method === 'POST') return addPasskeyOptions(request, env, userId)
    if (path === '/api/passkeys/verify' && request.method === 'POST') return addPasskeyVerify(request, env, userId)
    if (path === '/api/signout' && request.method === 'POST') return signOut(request, env)
  }

  return Response.json({ error: 'not found' }, { status: 404 })
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

  const counted = countStatements(env.jimbro)
  const revision = await upsertRows(counted.db, userId, parsed.rows)
  return json(request, { revision }, 200, countedHeaders(counted))
}

const handlePull = async (request: Request, env: Env, userId: string, url: URL) => {
  const cursor = parseCursor(url.searchParams.get('cursor'))
  const limit = parseLimit(url.searchParams.get('limit'))
  if (cursor === null) return json(request, { error: 'invalid_cursor' }, 400)
  if (limit === null) return json(request, { error: 'invalid_limit' }, 400)

  const counted = countStatements(env.jimbro)
  const page = await pullRows(counted.db, userId, cursor, limit)
  return json(request, page, 200, countedHeaders(counted))
}

const handleExport = async (request: Request, env: Env, userId: string) => {
  const counted = countStatements(env.jimbro)
  const rowSet = await loadRowSet(counted.db, userId, 4, new Date().toISOString())
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
