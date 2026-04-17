import { AuthEnv, resolveUserId } from './auth'
import { checkShrinkGuard } from './shrinkGuard'
import { countsFrom, ExportData } from './types'
import { validateShape } from './validate'

const ALLOWED_ORIGINS = new Set(['https://jimbro.nop33.com', 'http://localhost:5173'])

const withCors = (request: Request, response: Response) => {
  const origin = request.headers.get('Origin')
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response

  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

interface Env extends AuthEnv {
  BACKUP_BUCKET: R2Bucket
}

const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }))

    const response = await handleRequest(request, env)
    return withCors(request, response)
  }
} satisfies ExportedHandler<Env>

const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const path = url.pathname

  // Auth: Resolve userId from bearer token
  const userId = resolveUserId(request.headers.get('Authorization'), env)

  if (path.startsWith('/api/')) {
    if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 })

    if (path === '/api/ping' && request.method === 'GET') return Response.json({ ok: true, userId })
    if (path === '/api/snapshot' && request.method === 'PUT') return handlePutSnapshot(request, env, userId)
    if (path === '/api/snapshot/latest' && request.method === 'GET') return handleGetLatestSnapshot(env, userId)
  }

  return Response.json({ error: 'not found' }, { status: 404 })
}

const handlePutSnapshot = async (request: Request, env: Env, userId: string) => {
  // Check payload size
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > MAX_BODY_SIZE) return Response.json({ error: 'payload_too_large' }, { status: 413 })

  // Parse JSON body
  let data: unknown
  try {
    data = await request.json()
  } catch (error) {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Validate shape
  if (!validateShape(data)) return Response.json({ error: 'invalid_shape' }, { status: 400 })

  // Shrink guard: compare against previous snapshot
  const prevObject = await env.BACKUP_BUCKET.get(`users/${userId}/latest.json`)
  if (prevObject) {
    const prevData = await prevObject.json<ExportData>()
    const prevCounts = countsFrom(prevData)
    const nextCounts = countsFrom(data)
    const force = new URL(request.url).searchParams.get('force') === '1'
    const guard = checkShrinkGuard(prevCounts, nextCounts, force)

    if (!guard.passed) {
      return Response.json(
        {
          error: 'shrink_guard',
          rule: guard.rule,
          isHardRule: guard.isHardRule,
          previous: prevCounts,
          incoming: nextCounts
        },
        { status: 409 }
      )
    }
  }

  // Write to R2 storage
  const timestamp = new Date().toISOString()
  const body = JSON.stringify(data)

  try {
    await Promise.all([
      env.BACKUP_BUCKET.put(`users/${userId}/latest.json`, body),
      env.BACKUP_BUCKET.put(`users/${userId}/history/${timestamp}.json`, body)
    ])
  } catch (error) {
    return Response.json({ error: 'storage_error' }, { status: 500 })
  }

  return Response.json({ ok: true, timestamp, counts: countsFrom(data) }, { status: 200 })
}

const handleGetLatestSnapshot = async (env: Env, userId: string) => {
  const object = await env.BACKUP_BUCKET.get(`users/${userId}/latest.json`)

  if (!object) return Response.json({ error: 'not_found' }, { status: 404 })

  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } })
}
