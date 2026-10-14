import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ExportShape } from '../../src/db/types'
import fixture from './fixtures/latest-v4.json'
import { seedExport } from './seed'

const source = fixture as ExportShape

const copyHistory = (copies: number): ExportShape => {
  const exercises: ExportShape['stores']['exercises'] = []
  const programs: ExportShape['stores']['programs'] = []
  const workoutSessions: ExportShape['stores']['workoutSessions'] = []
  for (let copy = 0; copy < copies; copy++) {
    const suffix = copy === 0 ? '' : `~${copy}`
    const mapId = (id: string) => `${id}${suffix}`
    for (const exercise of source.stores.exercises) exercises.push({ ...exercise, id: mapId(exercise.id) })
    for (const program of source.stores.programs) {
      programs.push({ ...program, id: mapId(program.id), exercises: program.exercises.map(mapId) })
    }
    for (const session of source.stores.workoutSessions) {
      workoutSessions.push({
        ...session,
        id: mapId(session.id),
        programId: mapId(session.programId),
        exercises: session.exercises.map((exercise) => ({ ...exercise, exerciseId: mapId(exercise.exerciseId) }))
      })
    }
  }
  return { version: source.version, exportDate: source.exportDate, stores: { exercises, programs, workoutSessions } }
}

const history = copyHistory(4)

const newestSession = [...source.stores.workoutSessions].sort((left, right) => {
  if (left.date !== right.date) return left.date < right.date ? 1 : -1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
})[0]

// The exact statement and batch counts below catch an added query. The time budgets only catch a slowdown of an order
// of magnitude, such as a scan of the whole history: CI runners vary twentyfold from run to run, and their slowest
// medians so far were 192 ms a tool and 161 ms the export, against 2 to 3 ms and 39 ms on a laptop.
const TOOL_BUDGET_MS = 500
const EXPORT_BUDGET_MS = 1_000

const headers = {
  Authorization: 'Bearer test-token-123',
  'Content-Type': 'application/json',
  'x-d1-count': '1'
}

const call = (path: string, init: RequestInit = {}) => {
  const merged = new Headers(headers)
  new Headers(init.headers).forEach((value, name) => merged.set(name, value))
  return SELF.fetch(`https://example.com${path}`, { ...init, headers: merged })
}

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  call('/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })

const clearUser = async () => {
  await env.jimbro.batch([
    env.jimbro.prepare('DELETE FROM exercises WHERE user_id = ?1').bind('nikos'),
    env.jimbro.prepare('DELETE FROM programs WHERE user_id = ?1').bind('nikos'),
    env.jimbro.prepare('DELETE FROM sessions WHERE user_id = ?1').bind('nikos'),
    env.jimbro.prepare('DELETE FROM sets WHERE user_id = ?1').bind('nikos')
  ])
}

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[(sorted.length - 1) / 2]
}

const timed = async (run: () => Promise<Response>) => {
  const start = performance.now()
  const response = await run()
  const text = await response.text()
  const ms = performance.now() - start
  const statements = response.headers.get('x-d1-statements')
  const batches = response.headers.get('x-d1-batches')
  if (response.status !== 200 || statements === null || batches === null) {
    throw new Error(`${response.status} ${text}`)
  }
  return {
    ms,
    statements: Number(statements),
    batches: Number(batches),
    bytes: new TextEncoder().encode(text).byteLength,
    text
  }
}

describe('mcp perf', () => {
  it('keeps each tool within three queries and its time budget, and recent_sessions within 64KB', async () => {
    if (!newestSession?.exercises[0]) throw new Error('fixture has no session')
    await clearUser()
    await seedExport(history)

    const exportMs: number[] = []
    type Sample = { ms: number; statements: number; batches: number }
    const recent: Array<Sample & { bytes: number }> = []
    const session: Array<Sample> = []
    const historySamples: Array<Sample> = []
    const catalog: Array<Sample> = []

    for (let sample = 0; sample < 5; sample++) {
      const exported = await timed(() => call('/api/export'))
      exportMs.push(exported.ms)

      const listed = await timed(() => callTool('recent_sessions'))
      recent.push(listed)
      if (sample === 0) {
        const payload = JSON.parse(JSON.parse(listed.text).result.content[0].text) as { sessions: unknown[] }
        expect(payload.sessions).toHaveLength(10)
      }

      const opened = await timed(() => callTool('get_session', { id: newestSession.id }))
      session.push(opened)
      const history = await timed(() =>
        callTool('exercise_history', { exerciseId: newestSession.exercises[0].exerciseId })
      )
      historySamples.push(history)
      if (sample === 0) {
        const payloadOf = (text: string) => JSON.parse(JSON.parse(text).result.content[0].text)
        expect((payloadOf(opened.text) as { session: { id: string } | null }).session?.id).toBe(newestSession.id)
        expect((payloadOf(history.text) as { sessions: Array<{ sessionId: string }> }).sessions[0]?.sessionId).toBe(
          newestSession.id
        )
      }
      catalog.push(await timed(() => callTool('catalog')))
    }

    const recentMedian = median(recent.map((sample) => sample.ms))
    const sessionMedian = median(session.map((sample) => sample.ms))
    const historyMedian = median(historySamples.map((sample) => sample.ms))
    const catalogMedian = median(catalog.map((sample) => sample.ms))
    const recentBytes = Math.max(...recent.map((sample) => sample.bytes))
    console.info(
      `mcp perf export ${median(exportMs).toFixed(1)}ms recent ${recentMedian.toFixed(1)}ms/${recentBytes}B ` +
        `session ${sessionMedian.toFixed(1)}ms history ${historyMedian.toFixed(1)}ms ` +
        `catalog ${catalogMedian.toFixed(1)}ms`
    )

    const queries = (samples: Array<Sample>) => samples.map(({ statements, batches }) => ({ statements, batches }))
    expect(queries(recent)).toEqual(Array(5).fill({ statements: 3, batches: 2 }))
    expect(queries(session)).toEqual(Array(5).fill({ statements: 3, batches: 1 }))
    expect(queries(historySamples)).toEqual(Array(5).fill({ statements: 3, batches: 2 }))
    expect(queries(catalog)).toEqual(Array(5).fill({ statements: 3, batches: 1 }))
    expect(median(exportMs)).toBeLessThanOrEqual(EXPORT_BUDGET_MS)
    expect(recentMedian).toBeLessThanOrEqual(TOOL_BUDGET_MS)
    expect(sessionMedian).toBeLessThanOrEqual(TOOL_BUDGET_MS)
    expect(historyMedian).toBeLessThanOrEqual(TOOL_BUDGET_MS)
    expect(catalogMedian).toBeLessThanOrEqual(TOOL_BUDGET_MS)
    expect(Math.max(...recent.map((sample) => sample.bytes))).toBeLessThanOrEqual(65536)
  }, 180_000)
})
