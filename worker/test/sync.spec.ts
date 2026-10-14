import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ExportShape, Row } from '../../src/db/types'
import { rowsFromExport } from '../../src/sync/rows'
import fixture from './fixtures/latest-v4.json'
import { rowsOf, seedExport } from './seed'

const authHeaders = {
  Authorization: 'Bearer test-token-123',
  'Content-Type': 'application/json'
}

const api = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(authHeaders)
  new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  return SELF.fetch(`https://example.com${path}`, { ...init, headers })
}

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

type Pulled = { rows: Array<Row & { rev: number }>; cursor: number; more: boolean }

const pulled = async (cursor: string, limit: string) => (await (await pull(cursor, limit)).json()) as Pulled

// Every row the user holds, page by page, as a restore would read them.
const pullEverything = async () => {
  const rows: Pulled['rows'] = []
  let cursor = '0'
  for (;;) {
    const page = await pulled(cursor, '1000')
    rows.push(...page.rows)
    cursor = String(page.cursor)
    if (!page.more) return rows
  }
}

const nothingStored = { rows: [], cursor: 0, more: false }

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

    expect(await pulled('0', '1000')).toEqual({
      rows: [
        { table: 'exercises', row: exercise('bench', 'Bench'), rev: 2 },
        { table: 'exercises', row: exercise('row', 'Row'), rev: 3 },
        { table: 'exercises', row: renamed, rev: 4 }
      ],
      cursor: 4,
      more: false
    })
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
    expect(await pulled('0', '1000')).toEqual(nothingStored)
  })

  it('answers 400 invalid_row and writes nothing', async () => {
    const setWithoutSessionId = {
      id: 'set-1',
      exerciseId: 'squat',
      position: 0,
      set: { preset: 'lifting', reps: 5, weight: 100 },
      isDeleted: false,
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const pushed = await api('/api/push', {
      method: 'POST',
      body: JSON.stringify({
        rows: [
          { table: 'exercises', row: exercise('squat', 'Squat') },
          { table: 'sets', row: setWithoutSessionId }
        ]
      })
    })
    expect(pushed.status).toBe(400)
    expect(await pushed.json()).toEqual({ error: 'invalid_row', index: 1 })
    expect(await pulled('0', '1000')).toEqual(nothingStored)
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
    const before = await pullEverything()
    expect(before.map((entry) => entry.rev)).toEqual(Array.from({ length: 2711 }, (_, index) => index + 1))

    const rows = rowsOf(file)
    for (let start = 0; start < rows.length; start += 1000) {
      const again = await push(rows.slice(start, start + 1000))
      expect(await again.json()).toEqual({ revision: 2711 })
    }
    expect(await pullEverything()).toEqual(before)
    expect(await pulled('2711', '1000')).toEqual({ rows: [], cursor: 2711, more: false })

    const original = rowsFromExport(file).sets[0]
    if (original.set.preset !== 'lifting') throw new Error('expected a lifting set')
    const changed = { ...original, set: { ...original.set, weight: original.set.weight + 5 } }
    const pushed = await push([{ table: 'sets', row: changed }])
    expect(await pushed.json()).toEqual({ revision: 2712 })
    expect(await pulled('2711', '1000')).toEqual({
      rows: [{ table: 'sets', row: changed, rev: 2712 }],
      cursor: 2712,
      more: false
    })
  })
})

describe('auth', () => {
  it('answers 401 on every route that needs a bearer token when it has none', async () => {
    const routes = [
      ['GET', '/api/ping'],
      ['POST', '/api/push'],
      ['GET', '/api/pull'],
      ['GET', '/api/export'],
      ['POST', '/api/passkeys/options'],
      ['POST', '/api/passkeys/verify'],
      ['POST', '/api/signout'],
      ['POST', '/mcp']
    ] as const
    for (const [method, path] of routes) {
      const response = await SELF.fetch(`https://example.com${path}`, { method })
      expect([path, response.status, await response.json()]).toEqual([path, 401, { error: 'unauthorized' }])
    }
  })
})
