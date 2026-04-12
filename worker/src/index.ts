import { AuthEnv, resolveUserId } from './auth'
import { countsFrom } from './types'
import { validateShape } from './validate'

interface Env extends AuthEnv {
  BACKUP_BUCKET: R2Bucket
}

const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Auth: Resolve userId from bearer token
    const userId = resolveUserId(request.headers.get('Authorization'), env)

    if (path.startsWith('/api/')) {
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 })

      if (path === '/api/ping' && request.method === 'GET') return Response.json({ ok: true, userId })
      if (path === '/api/snapshot' && request.method === 'PUT') return handlePutSnapshot(request, env, userId)

      return Response.json({ error: 'not found' }, { status: 404 })
    }

    return Response.json({ error: 'not found' }, { status: 404 })
  }
} satisfies ExportedHandler<Env>

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
