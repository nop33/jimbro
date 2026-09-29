import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ExportShape } from '../../src/sync/rows'
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

const pushRows = Array.from({ length: 1000 }, (_, index) => ({
  table: 'sets' as const,
  row: {
    id: `perf-set-${index}`,
    sessionId: 'perf-session',
    exerciseId: 'perf-exercise',
    position: index,
    set: { preset: 'lifting' as const, reps: 5, weight: 40 },
    isDeleted: false,
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
}))

const headers = {
  Authorization: 'Bearer test-token-123',
  'Content-Type': 'application/json',
  'x-d1-count': '1'
}

const call = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://example.com${path}`, { ...init, headers: { ...headers, ...init.headers } })

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
  const ms = performance.now() - start
  const statements = response.headers.get('x-d1-statements')
  const batches = response.headers.get('x-d1-batches')
  if (response.status !== 200 || statements === null || batches === null) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  return { ms, statements: Number(statements), batches: Number(batches) }
}

describe('sync perf', () => {
  it('keeps a 1000-row push and a 1000-row pull on a four-copy history inside the budgets', async () => {
    const pushMs: number[] = []
    const pullMs: number[] = []
    const pushStatements: number[] = []
    const pullStatements: number[] = []

    for (let sample = 0; sample < 5; sample++) {
      await clearUser()
      await seedExport(history)

      const pushed = await timed(() => call('/api/push', { method: 'POST', body: JSON.stringify({ rows: pushRows }) }))
      pushMs.push(pushed.ms)
      pushStatements.push(pushed.statements)
      expect(pushed.batches).toBe(1)
      expect(pushed.statements).toBeGreaterThan(0)
      expect(pushed.statements).toBeLessThanOrEqual(20)

      const pulled = await timed(() => call('/api/pull?cursor=0&limit=1000'))
      pullMs.push(pulled.ms)
      pullStatements.push(pulled.statements)
      expect(pulled.batches).toBe(1)
      expect(pulled.statements).toBeGreaterThan(0)
      expect(pulled.statements).toBeLessThanOrEqual(20)
    }

    expect(median(pushMs)).toBeLessThan(1_000)
    expect(median(pullMs)).toBeLessThan(500)
    expect(Math.max(...pushStatements, ...pullStatements)).toBeLessThanOrEqual(20)
  }, 180_000)
})
