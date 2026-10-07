import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ExerciseRow, ProgramRow, Row, SessionHeader, SetRow } from '../../src/db/types'
import { MCP_TOOLS } from '../src/mcp'

const authHeaders = {
  Authorization: 'Bearer test-token-123',
  'Content-Type': 'application/json'
}

const updatedAt = '2026-01-02T00:00:00.000Z'

const exercise = (id: string, name: string, isDeleted = false): ExerciseRow => ({
  id,
  name,
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'quads',
  targetSets: 3,
  defaults: { reps: 5 },
  isDeleted,
  updatedAt
})

const program = (id: string, name: string, exercises: string[], isDeleted = false): ProgramRow => ({
  id,
  name,
  exercises,
  isDeleted,
  updatedAt
})

const snapshot = (exerciseId: string, name: string) => ({
  exerciseId,
  name,
  kind: 'lifting' as const,
  preset: 'lifting' as const,
  muscle: 'quads' as const,
  targetSets: 3,
  defaults: { reps: 5 }
})

const session = (
  id: string,
  date: string,
  exercises: Array<ReturnType<typeof snapshot>>,
  isDeleted = false
): SessionHeader => ({
  id,
  date,
  programId: 'push',
  location: 'gym',
  status: 'completed',
  exercises,
  isDeleted,
  updatedAt
})

const setRow = (
  sessionId: string,
  exerciseId: string,
  position: number,
  weight: number,
  isDeleted = false
): SetRow => ({
  id: `${sessionId}:${exerciseId}:${position}`,
  sessionId,
  exerciseId,
  position,
  set: { preset: 'lifting', reps: 5, weight },
  isDeleted,
  updatedAt
})

const squat = snapshot('squat', 'Squat')
const bench = snapshot('bench', 'Bench')
const early = session('early', '2025-12-31', [squat])
const mid = session('mid', '2026-01-01', [squat, bench])
const late = session('late', '2026-01-02', [bench, squat])
const tomb = session('tomb', '2026-01-03', [squat], true)

const rows: Row[] = [
  { table: 'exercises', row: exercise('bench', 'Bench') },
  { table: 'exercises', row: exercise('ghost', 'Ghost', true) },
  { table: 'exercises', row: exercise('squat', 'Squat') },
  { table: 'programs', row: program('legs', 'Legs', ['squat']) },
  { table: 'programs', row: program('old', 'Old', ['squat'], true) },
  { table: 'programs', row: program('push', 'Push', ['bench']) },
  { table: 'sessions', row: early },
  { table: 'sessions', row: mid },
  { table: 'sessions', row: late },
  { table: 'sessions', row: tomb },
  { table: 'sets', row: setRow('mid', 'bench', 0, 40) },
  { table: 'sets', row: setRow('mid', 'bench', 1, 45, true) },
  { table: 'sets', row: setRow('mid', 'squat', 0, 60) },
  { table: 'sets', row: setRow('mid', 'squat', 1, 70) },
  { table: 'sets', row: setRow('early', 'squat', 0, 50) },
  { table: 'sets', row: setRow('late', 'bench', 0, 50) },
  { table: 'sets', row: setRow('late', 'squat', 0, 80) },
  { table: 'sets', row: setRow('tomb', 'squat', 0, 100) }
]

const api = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://example.com${path}`, { ...init, headers: { ...authHeaders, ...init.headers } })

const rpc = (method: string, params?: unknown, id: number | string = 1, headers?: HeadersInit) =>
  api('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params })
  })

const tool = async (name: string, args: Record<string, unknown> = {}, headers?: HeadersInit) => {
  const response = await rpc('tools/call', { name, arguments: args }, 1, headers)
  expect(response.status).toBe(200)
  const body = (await response.json()) as { result: { content: Array<{ type: string; text: string }> } }
  return JSON.parse(body.result.content[0].text) as { revision: number }
}

const fingerprint = async () => {
  const tables = ['exercises', 'programs', 'sessions', 'sets'] as const
  const parts: string[] = []
  for (const table of tables) {
    const result = await env.jimbro
      .prepare(`SELECT id, rev, data FROM ${table} WHERE user_id = ?1 ORDER BY id`)
      .bind('nikos')
      .all()
    parts.push(JSON.stringify(result.results))
  }
  return parts.join('\n')
}

const maxRev = async () => {
  const row = await env.jimbro
    .prepare(
      `SELECT COALESCE(MAX(rev), 0) AS rev FROM (
        SELECT MAX(rev) AS rev FROM exercises WHERE user_id = ?1
        UNION ALL SELECT MAX(rev) AS rev FROM programs WHERE user_id = ?1
        UNION ALL SELECT MAX(rev) AS rev FROM sessions WHERE user_id = ?1
        UNION ALL SELECT MAX(rev) AS rev FROM sets WHERE user_id = ?1
      )`
    )
    .bind('nikos')
    .first<{ rev: number }>()
  return row?.rev ?? -1
}

describe('mcp', () => {
  beforeEach(async () => {
    await env.jimbro.batch([
      env.jimbro.prepare('DELETE FROM exercises WHERE user_id = ?1').bind('nikos'),
      env.jimbro.prepare('DELETE FROM programs WHERE user_id = ?1').bind('nikos'),
      env.jimbro.prepare('DELETE FROM sessions WHERE user_id = ?1').bind('nikos'),
      env.jimbro.prepare('DELETE FROM sets WHERE user_id = ?1').bind('nikos')
    ])
    const pushed = await api('/api/push', { method: 'POST', body: JSON.stringify({ rows }) })
    expect(pushed.status).toBe(200)
  })

  it('lists exactly the four tools and does not touch D1', async () => {
    const response = await rpc('tools/list', {}, 2, { 'x-d1-count': '1' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((item) => item.name)).toEqual(MCP_TOOLS.map((item) => item.name))
    expect(body.result.tools.map((item) => item.name)).toEqual([
      'recent_sessions',
      'get_session',
      'exercise_history',
      'catalog'
    ])
    expect(response.headers.get('x-d1-statements')).toBe('0')
    expect(response.headers.get('x-d1-batches')).toBe('0')
  })

  it('answers initialize and accepts the initialized notification', async () => {
    const opened = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' }
    })
    expect(opened.status).toBe(200)
    const body = (await opened.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.serverInfo.name).toBe('jimbro')

    const noted = await api('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    expect(noted.status).toBe(202)
    expect(await noted.text()).toBe('')
  })

  it('recent_sessions returns live headers newest first and hides a tombstone', async () => {
    const payload = await tool('recent_sessions', { limit: 10 })
    expect(payload).toEqual({
      revision: await maxRev(),
      sessions: [
        { ...late, setCounts: [1, 1] },
        { ...mid, setCounts: [2, 1] },
        { ...early, setCounts: [1] }
      ]
    })
    expect(await tool('recent_sessions')).toEqual(payload)
    expect(await tool('recent_sessions', { limit: 1 })).toEqual({
      revision: payload.revision,
      sessions: [{ ...late, setCounts: [1, 1] }]
    })
  })

  it('get_session returns the header and live sets in exercise order', async () => {
    expect(await tool('get_session', { id: 'mid' })).toEqual({
      revision: await maxRev(),
      session: mid,
      sets: [setRow('mid', 'squat', 0, 60), setRow('mid', 'squat', 1, 70), setRow('mid', 'bench', 0, 40)]
    })
    expect(await tool('get_session', { id: 'tomb' })).toEqual({ revision: await maxRev(), session: null, sets: [] })
    expect(await tool('get_session', { id: 'missing' })).toEqual({ revision: await maxRev(), session: null, sets: [] })
  })

  it('exercise_history groups live sets by session, newest first', async () => {
    expect(await tool('exercise_history', { exerciseId: 'squat', limit: 20 })).toEqual({
      revision: await maxRev(),
      sessions: [
        { sessionId: 'late', date: '2026-01-02', sets: [setRow('late', 'squat', 0, 80)] },
        { sessionId: 'mid', date: '2026-01-01', sets: [setRow('mid', 'squat', 0, 60), setRow('mid', 'squat', 1, 70)] },
        { sessionId: 'early', date: '2025-12-31', sets: [setRow('early', 'squat', 0, 50)] }
      ]
    })
    expect(await tool('exercise_history', { exerciseId: 'squat', limit: 1 })).toEqual({
      revision: await maxRev(),
      sessions: [{ sessionId: 'late', date: '2026-01-02', sets: [setRow('late', 'squat', 0, 80)] }]
    })
  })

  it('catalog returns non-deleted exercises and programs', async () => {
    expect(await tool('catalog')).toEqual({
      revision: await maxRev(),
      exercises: [exercise('bench', 'Bench'), exercise('squat', 'Squat')],
      programs: [program('legs', 'Legs', ['squat']), program('push', 'Push', ['bench'])]
    })
  })

  it('revision equals the maximum rev', async () => {
    const payload = await tool('catalog', {}, { 'x-d1-count': '1' })
    expect(payload.revision).toBe(await maxRev())
    expect(payload.revision).toBe(rows.length)
  })

  it('returns 401 without a bearer token', async () => {
    const response = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns a JSON-RPC error for an unknown tool and does not write', async () => {
    const before = await fingerprint()
    const response = await rpc('tools/call', { name: 'nope', arguments: {} }, 7, { 'x-d1-count': '1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32602, message: 'Unknown tool' } })
    expect(response.headers.get('x-d1-statements')).toBe('0')
    expect(response.headers.get('x-d1-batches')).toBe('0')
    expect(await fingerprint()).toBe(before)
  })

  it('rejects a bad limit without touching D1', async () => {
    const before = await fingerprint()
    const response = await rpc('tools/call', { name: 'recent_sessions', arguments: { limit: 0 } }, 8, {
      'x-d1-count': '1'
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 8,
      error: { code: -32602, message: 'Invalid params' }
    })
    expect(response.headers.get('x-d1-statements')).toBe('0')
    expect(await fingerprint()).toBe(before)
  })

  it('answers GET with 405 even when the token is missing', async () => {
    const response = await SELF.fetch('https://example.com/mcp')
    expect(response.status).toBe(405)
  })
})
