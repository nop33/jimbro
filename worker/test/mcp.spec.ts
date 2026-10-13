import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ExerciseRow, ProgramRow, Row, SessionHeader, SetRow } from '../../src/db/types'

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

const api = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(authHeaders)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  return SELF.fetch(`https://example.com${path}`, { ...init, headers })
}

const rpc = (method: string, params?: unknown, id: number | string = 1, headers?: HeadersInit) =>
  api('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params })
  })

const tool = async (name: string, args: Record<string, unknown> = {}, headers?: HeadersInit) => {
  const response = await rpc('tools/call', { name, arguments: args }, 1, headers)
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    result: { content: Array<{ type: string; text: string }>; structuredContent: unknown }
  }
  const payload = JSON.parse(body.result.content[0].text) as { revision: number }
  // Clients read either the text or the structured content, so both carry the same payload.
  expect(body.result.structuredContent).toEqual(payload)
  return payload
}

// beforeEach pushes 18 rows into an empty account, so they hold revisions 1 to 18.
const REVISION = 18

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
    // An older version than the server's default, so the answer shows it echoes the client's.
    const opened = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' }
    })
    expect(opened.status).toBe(200)
    expect(await opened.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'jimbro', version: '1.0.0' },
        instructions: expect.stringMatching(/^Read-only workout history\. /)
      }
    })

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
      revision: REVISION,
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
      revision: REVISION,
      session: mid,
      sets: [setRow('mid', 'squat', 0, 60), setRow('mid', 'squat', 1, 70), setRow('mid', 'bench', 0, 40)]
    })
    expect(await tool('get_session', { id: 'tomb' })).toEqual({ revision: REVISION, session: null, sets: [] })
    expect(await tool('get_session', { id: 'missing' })).toEqual({ revision: REVISION, session: null, sets: [] })
  })

  it('exercise_history groups live sets by session, newest first', async () => {
    expect(await tool('exercise_history', { exerciseId: 'squat', limit: 20 })).toEqual({
      revision: REVISION,
      sessions: [
        { sessionId: 'late', date: '2026-01-02', sets: [setRow('late', 'squat', 0, 80)] },
        { sessionId: 'mid', date: '2026-01-01', sets: [setRow('mid', 'squat', 0, 60), setRow('mid', 'squat', 1, 70)] },
        { sessionId: 'early', date: '2025-12-31', sets: [setRow('early', 'squat', 0, 50)] }
      ]
    })
    expect(await tool('exercise_history', { exerciseId: 'squat', limit: 1 })).toEqual({
      revision: REVISION,
      sessions: [{ sessionId: 'late', date: '2026-01-02', sets: [setRow('late', 'squat', 0, 80)] }]
    })
  })

  it('catalog returns non-deleted exercises and programs', async () => {
    expect(await tool('catalog')).toEqual({
      revision: REVISION,
      exercises: [exercise('bench', 'Bench'), exercise('squat', 'Squat')],
      programs: [program('legs', 'Legs', ['squat']), program('push', 'Push', ['bench'])]
    })
  })

  it('returns a JSON-RPC error for an unknown tool and does not write', async () => {
    const response = await rpc('tools/call', { name: 'nope', arguments: {} }, 7, { 'x-d1-count': '1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32602, message: 'Unknown tool' } })
    expect(response.headers.get('x-d1-statements')).toBe('0')
    expect(response.headers.get('x-d1-batches')).toBe('0')
  })

  it('rejects a bad limit without touching D1', async () => {
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
  })

  it('answers GET with 405 even when the token is missing', async () => {
    const response = await SELF.fetch('https://example.com/mcp')
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'method not allowed' })
  })
})
