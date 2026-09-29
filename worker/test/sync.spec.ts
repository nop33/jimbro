import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { rowsFromExport, type ExportShape } from '../../src/sync/rows'
import type { Row } from '../src/rows'
import fixture from './fixtures/latest-v4.json'
import { rowsOf, seedExport } from './seed'

const authHeaders = {
  Authorization: 'Bearer test-token-123',
  'Content-Type': 'application/json'
}

const api = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { ...authHeaders, ...init.headers }
  })

const exercise = (id: string, name: string) => ({
  id,
  name,
  kind: 'lifting' as const,
  preset: 'lifting' as const,
  muscle: 'quads' as const,
  targetSets: 3,
  defaults: { reps: 5 },
  isDeleted: false,
  updatedAt: '2026-01-02T00:00:00.000Z'
})

const push = (rows: Row[], headers?: HeadersInit) =>
  api('/api/push', { method: 'POST', body: JSON.stringify({ rows }), headers })

const pull = (cursor: string, limit: string) => api(`/api/pull?cursor=${cursor}&limit=${limit}`)

const countRows = async (table: 'exercises' | 'programs' | 'sessions' | 'sets') => {
  const row = await env.jimbro
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`)
    .bind('nikos')
    .first<{ n: number }>()
  return row?.n ?? -1
}

const dumpRevData = async () => {
  const tables = ['exercises', 'programs', 'sessions', 'sets'] as const
  const dumped: Record<(typeof tables)[number], Array<{ id: string; rev: number; data: string }>> = {
    exercises: [],
    programs: [],
    sessions: [],
    sets: []
  }
  for (const table of tables) {
    const result = await env.jimbro
      .prepare(`SELECT id, rev, data FROM ${table} WHERE user_id = ?1 ORDER BY id`)
      .bind('nikos')
      .all<{ id: string; rev: number; data: string }>()
    dumped[table] = result.results
  }
  return dumped
}

const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

const sortedExport = (data: {
  version: number
  stores: {
    exercises: Array<{ id: string }>
    programs: Array<{ id: string }>
    workoutSessions: Array<{ id: string }>
  }
}) => ({
  version: data.version,
  stores: {
    exercises: byId(data.stores.exercises),
    programs: byId(data.stores.programs),
    workoutSessions: byId(data.stores.workoutSessions)
  }
})

describe('push and pull', () => {
  const squat = exercise('squat', 'Squat')
  const bench = exercise('bench', 'Bench')
  const row = exercise('row', 'Row')

  it('returns revisions 1 to 3 and pages them', async () => {
    const created = await push(
      [
        { table: 'exercises', row: squat },
        { table: 'exercises', row: bench },
        { table: 'exercises', row: row }
      ],
      { 'x-d1-count': '1' }
    )
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ revision: 3 })
    expect(created.headers.get('x-d1-batches')).toBe('1')
    expect(created.headers.get('x-d1-statements')).toBe('2')

    const all = await pull('0', '1000')
    expect(all.status).toBe(200)
    expect(await all.json()).toEqual({
      rows: [
        { table: 'exercises', row: squat, rev: 1 },
        { table: 'exercises', row: bench, rev: 2 },
        { table: 'exercises', row: row, rev: 3 }
      ],
      cursor: 3,
      more: false
    })

    const first = await pull('0', '2')
    expect(await first.json()).toEqual({
      rows: [
        { table: 'exercises', row: squat, rev: 1 },
        { table: 'exercises', row: bench, rev: 2 }
      ],
      cursor: 2,
      more: true
    })

    const second = await pull('2', '2')
    expect(await second.json()).toEqual({
      rows: [{ table: 'exercises', row, rev: 3 }],
      cursor: 3,
      more: false
    })
  })

  it('keeps one row and moves a repeated id to revision 4', async () => {
    const squat = exercise('squat', 'Squat')
    await push([
      { table: 'exercises', row: squat },
      { table: 'exercises', row: exercise('bench', 'Bench') },
      { table: 'exercises', row: exercise('row', 'Row') }
    ])
    const renamed = exercise('squat', 'Back squat')
    const repeated = await push([{ table: 'exercises', row: renamed }])
    expect(await repeated.json()).toEqual({ revision: 4 })
    expect(await countRows('exercises')).toBe(3)

    const page = (await pull('0', '1000').then((response) => response.json())) as {
      rows: Array<{ row: { id: string; name: string }; rev: number }>
    }
    const matches = page.rows.filter((item) => item.row.id === 'squat')
    expect(matches).toEqual([{ table: 'exercises', row: renamed, rev: 4 }])
  })
})

describe('push validation', () => {
  it('rejects a push of more than 1000 rows', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      table: 'exercises' as const,
      row: exercise(`id-${index}`, 'Name')
    }))
    const response = await push(rows)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'too_many_rows' })
    expect(await countRows('exercises')).toBe(0)
  })

  it('answers 400 invalid_row and writes nothing', async () => {
    const pushed = await push([
      { table: 'exercises', row: exercise('squat', 'Squat') },
      {
        table: 'sets',
        row: {
          id: 'set-1',
          exerciseId: 'squat',
          position: 0,
          set: { preset: 'lifting', reps: 5, weight: 100 },
          isDeleted: false,
          updatedAt: '2026-01-02T00:00:00.000Z'
        }
      }
    ])
    expect(pushed.status).toBe(400)
    expect(await pushed.json()).toEqual({ error: 'invalid_row', index: 1 })
    expect(await countRows('exercises')).toBe(0)
    expect(await countRows('sets')).toBe(0)
  })
})

describe('export', () => {
  const file = fixture as ExportShape

  it('exports the stored rows dated at the time of the export', async () => {
    await seedExport(file)
    const before = Date.now()
    const exported = await api('/api/export')
    expect(exported.status).toBe(200)
    expect(exported.headers.get('Content-Disposition')).toBe('attachment; filename="jimbro-export.json"')
    const body = (await exported.json()) as ExportShape
    expect(sortedExport(body)).toEqual(sortedExport(file))
    expect(Date.parse(body.exportDate)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(body.exportDate)).toBeLessThanOrEqual(Date.now())
  })

  it('keeps every revision when the same rows are pushed again', async () => {
    expect(await seedExport(file)).toBe(2711)
    const before = await dumpRevData()
    const revs = (['exercises', 'programs', 'sessions', 'sets'] as const)
      .flatMap((table) => before[table].map((row) => row.rev))
      .sort((left, right) => left - right)
    expect(revs).toEqual(Array.from({ length: 2711 }, (_, index) => index + 1))

    const rows = rowsOf(file)
    for (let start = 0; start < rows.length; start += 1000) {
      const again = await push(rows.slice(start, start + 1000))
      expect(await again.json()).toEqual({ revision: 2711 })
    }
    expect(await dumpRevData()).toEqual(before)

    const stale = (await pull('2711', '1000').then((response) => response.json())) as { rows: unknown[]; more: boolean }
    expect(stale.rows).toEqual([])
    expect(stale.more).toBe(false)

    const original = rowsFromExport(file).sets[0]
    if (original.set.preset !== 'lifting') throw new Error('expected a lifting set')
    const changed = { ...original, set: { ...original.set, weight: original.set.weight + 5 } }
    const pushed = await push([{ table: 'sets', row: changed }])
    expect(await pushed.json()).toEqual({ revision: 2712 })
    const stored = await env.jimbro
      .prepare('SELECT rev FROM sets WHERE user_id = ?1 AND id = ?2')
      .bind('nikos', original.id)
      .first<{ rev: number }>()
    expect(stored).toEqual({ rev: 2712 })
    expect(await countRows('sets')).toBe(2581)
  })
})

describe('auth', () => {
  it('answers 401 on every new route without a token', async () => {
    const routes = [
      ['POST', '/api/push'],
      ['GET', '/api/pull'],
      ['GET', '/api/export']
    ] as const
    for (const [method, path] of routes) {
      const response = await SELF.fetch(`https://example.com${path}`, { method })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'unauthorized' })
    }
  })
})
