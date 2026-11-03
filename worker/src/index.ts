import { AuthEnv, resolveUserId } from './auth'
import { BreakAlarm, handleBreakAlerts, type BreakAlertsEnv } from './breakAlerts'
import { handleMcp } from './mcp'
import {
  authorizationServerMetadata,
  authorize,
  connectDeny,
  connectOptions,
  connectRequest,
  connectVerify,
  isOpenPath,
  listConnections,
  mcpUnauthorized,
  protectedResourceMetadata,
  registerClient,
  resolveAccessToken,
  revoke,
  revokeConnection,
  token,
  type OAuthEnv
} from './oauth'
import { isAllowedOrigin, type OriginEnv } from './origins'
import {
  addPasskeyOptions,
  addPasskeyVerify,
  claimAccount,
  registerOptions,
  registerVerify,
  signInOptions,
  signInVerify,
  signOut
} from './passkeys'
import { exportFromRows } from '../../src/sync/rows'
import { countStatements, loadRowSet, parsePushBody, pullRows, upsertRows, ROW_CAP, ROW_LIMIT } from './rows'

const withCors = (request: Request, response: Response, env: Env) => {
  const origin = request.headers.get('Origin')
  // An assistant running in a browser may call /mcp and the OAuth endpoints from any origin. It sends its token in a
  // header, never a cookie, so allowing every origin there gives a page nothing it doesn't hold already.
  const open = isOpenPath(new URL(request.url).pathname)
  if (!open && !isAllowedOrigin(origin, env)) return response
  if (origin === null) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', open ? '*' : origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    open ? 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id' : 'Content-Type, Authorization'
  )
  if (open) headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

interface Env extends AuthEnv, OriginEnv, BreakAlertsEnv, OAuthEnv {
  jimbro: D1Database
  // Limits the public passkey and OAuth routes per client address. See wrangler.jsonc.
  AUTH_LIMITER: RateLimit
  // Limits each user's pushes. See wrangler.jsonc.
  PUSH_LIMITER: RateLimit
  // 'off' skips AUTH_LIMITER. Only the Playwright run's local worker sets it, since all its browsers share one address.
  AUTH_RATE_LIMIT?: string
  // The most rows a user may store, when not ROW_CAP. Tests lower it.
  ROW_CAP?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }), env)

    let response: Response
    try {
      response = await handleRequest(request, env)
    } catch (error) {
      // A failure still answers with the CORS headers, so the app reads the status instead of a network error.
      console.error('request failed', error)
      response = Response.json({ error: 'internal' }, { status: 500 })
    }
    return withCors(request, response, env)
  }
} satisfies ExportedHandler<Env>

// workerd finds a Durable Object's class among the main module's exports.
export { BreakAlarm }

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
  ['/auth/signin/verify', signInVerify],
  ['/auth/connect/request', connectRequest],
  ['/auth/connect/options', connectOptions],
  ['/auth/connect/verify', connectVerify],
  ['/auth/connect/deny', connectDeny]
])

// The OAuth routes an assistant calls, with the method each takes. They have a budget of their own per address, apart
// from the app's passkey routes.
const OAUTH_ROUTES = new Map<
  string,
  { method: 'GET' | 'POST'; handle: (request: Request, env: Env) => Promise<Response> }
>([
  ['/oauth/register', { method: 'POST', handle: registerClient }],
  ['/oauth/authorize', { method: 'GET', handle: authorize }],
  ['/oauth/token', { method: 'POST', handle: token }],
  ['/oauth/revoke', { method: 'POST', handle: revoke }]
])

const DISCOVERY_ROUTES = new Map<string, (request: Request) => Response>([
  ['/.well-known/oauth-protected-resource', protectedResourceMetadata],
  ['/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata],
  ['/.well-known/oauth-authorization-server', authorizationServerMetadata]
])

const withinBudget = async (request: Request, env: Env, prefix: string) => {
  if (env.AUTH_RATE_LIMIT === 'off') return true
  const client = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { success } = await env.AUTH_LIMITER.limit({ key: `${prefix}:${client}` })
  return success
}

const handlePublicAuth = async (
  request: Request,
  env: Env,
  handle: (request: Request, env: Env) => Promise<Response>
) => {
  if (request.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 })
  if (!(await withinBudget(request, env, 'auth'))) return Response.json({ error: 'rate_limited' }, { status: 429 })
  return handle(request, env)
}

const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const path = url.pathname

  const publicAuth = PUBLIC_AUTH_ROUTES.get(path)
  if (publicAuth) return handlePublicAuth(request, env, publicAuth)

  const discovery = DISCOVERY_ROUTES.get(path)
  if (discovery && request.method === 'GET') return discovery(request)

  const oauth = OAUTH_ROUTES.get(path)
  if (oauth) {
    if (request.method !== oauth.method) return Response.json({ error: 'method not allowed' }, { status: 405 })
    if (!(await withinBudget(request, env, 'oauth'))) return Response.json({ error: 'rate_limited' }, { status: 429 })
    return oauth.handle(request, env)
  }

  // Auth: Resolve userId from bearer token. An OAuth access token resolves to nobody here, so it never reaches /api/.
  const userId = await resolveUserId(request.headers.get('Authorization'), env)

  if (path === '/mcp') {
    if (request.method !== 'POST') {
      return finish(request, Response.json({ error: 'method not allowed' }, { status: 405 }))
    }
    const reader = userId ?? (await resolveAccessToken(request, env))
    if (!reader) return finish(request, mcpUnauthorized(request, request.headers.has('Authorization')))
    return finish(request, await handleMcp(request, env.jimbro, reader))
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
    if (path === '/api/claim' && request.method === 'POST') return claimAccount(request, env, userId)
    if (path === '/api/connections' && request.method === 'GET') return listConnections(env, userId)
    if (path === '/api/connections/revoke' && request.method === 'POST') return revokeConnection(request, env, userId)
    if (path === '/api/break-alerts' || path.startsWith('/api/break-alerts/')) {
      return handleBreakAlerts(request, env, userId, path)
    }
  }

  return Response.json({ error: 'not found' }, { status: 404 })
}

const handlePush = async (request: Request, env: Env, userId: string) => {
  const { success } = await env.PUSH_LIMITER.limit({ key: `push:${userId}` })
  if (!success) return json(request, { error: 'rate_limited' }, 429)

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
  const cap = env.ROW_CAP ? Number(env.ROW_CAP) : ROW_CAP
  const revision = await upsertRows(counted.db, userId, parsed.rows, cap)
  if (revision === null) return json(request, { error: 'row_limit', cap }, 413, countedHeaders(counted))
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
