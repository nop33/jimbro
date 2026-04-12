import { AuthEnv, resolveUserId } from './auth'

interface Env extends AuthEnv {
  BACKUP_BUCKET: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Auth: Resolve userId from bearer token
    const userId = resolveUserId(request.headers.get('Authorization'), env)

    if (path.startsWith('/api/')) {
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 })
      if (path === '/api/ping' && request.method === 'GET') return Response.json({ ok: true, userId })
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    return Response.json({ error: 'not found' }, { status: 404 })
  }
} satisfies ExportedHandler<Env>
