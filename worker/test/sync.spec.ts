import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import january from '../../data-backup/gymbro-export-2026-01-02.json'
import { flattenRowSet, rowsFromExport, upsertRows, type ExportShape, type Row } from '../src/rows'
import fixture from './fixtures/latest-v4.json'

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

const dumpData = async () => {
  const tables = ['exercises', 'programs', 'sessions', 'sets'] as const
  const dumped: Record<(typeof tables)[number], string[]> = {
    exercises: [],
    programs: [],
    sessions: [],
    sets: []
  }
  for (const table of tables) {
    const result = await env.jimbro
      .prepare(`SELECT data FROM ${table} WHERE user_id = ?1 ORDER BY id`)
      .bind('nikos')
      .all<{ data: string }>()
    dumped[table] = result.results.map((item) => item.data)
  }
  return dumped
}

const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

const sortedExport = (data: {
  version: number
  exportDate: string
  stores: {
    exercises: Array<{ id: string }>
    programs: Array<{ id: string }>
    workoutSessions: Array<{ id: string }>
  }
}) => ({
  version: data.version,
  exportDate: data.exportDate,
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
      more: false,
      importedExportDate: null
    })

    const first = await pull('0', '2')
    expect(await first.json()).toEqual({
      rows: [
        { table: 'exercises', row: squat, rev: 1 },
        { table: 'exercises', row: bench, rev: 2 }
      ],
      cursor: 2,
      more: true,
      importedExportDate: null
    })

    const second = await pull('2', '2')
    const secondBody = await second.json()
    expect(secondBody).toEqual({
      rows: [{ table: 'exercises', row, rev: 3 }],
      cursor: 3,
      more: false
    })
    expect(secondBody).not.toHaveProperty('importedExportDate')
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

describe('import gate', () => {
  it('answers 409 import_required on push and pull while latest.json has no marker', async () => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', '{"version":4,"exportDate":"2026-01-02T00:00:00.000Z"}')
    const pushed = await push([{ table: 'exercises', row: exercise('squat', 'Squat') }])
    expect(pushed.status).toBe(409)
    expect(await pushed.json()).toEqual({ error: 'import_required' })
    const pulled = await pull('0', '1000')
    expect(pulled.status).toBe(409)
    expect(await pulled.json()).toEqual({ error: 'import_required' })
    expect(await countRows('exercises')).toBe(0)
    expect(await countRows('programs')).toBe(0)
    expect(await countRows('sessions')).toBe(0)
    expect(await countRows('sets')).toBe(0)
  })

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

  it('rejects the January version 1 export', async () => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', JSON.stringify(january))
    const response = await api('/api/import-r2', { method: 'POST' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_export' })
    expect(await countRows('sessions')).toBe(0)
    expect(await countRows('sets')).toBe(0)
  })
})

describe('import and export', () => {
  const file = fixture as ExportShape

  it('imports the version 4 fixture and exports the same rows', async () => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', JSON.stringify(file))
    const imported = await api('/api/import-r2', { method: 'POST' })
    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual({
      counts: { exercises: 21, programs: 3, sessions: 106, sets: 2581 },
      revision: 2711
    })

    const exported = await api('/api/export')
    expect(exported.status).toBe(200)
    expect(exported.headers.get('Content-Disposition')).toBe('attachment; filename="jimbro-export.json"')
    expect(sortedExport(await exported.json())).toEqual(sortedExport(file))

    const again = await api('/api/import-r2', { method: 'POST' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'already_imported' })
    expect(await countRows('sets')).toBe(2581)

    const pulled = await pull('0', '1000')
    const body = (await pulled.json()) as { rows: unknown[]; more: boolean; importedExportDate: string }
    expect(body.rows).toHaveLength(1000)
    expect(body.more).toBe(true)
    expect(body.importedExportDate).toBe(file.exportDate)
  })

  it('leaves the same row contents when the marker write is skipped and import runs again', async () => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', JSON.stringify(file))
    await upsertDirect()
    expect(await env.BACKUP_BUCKET.head('users/nikos/import.json')).toBeNull()
    const before = await dumpData()

    const imported = await api('/api/import-r2', { method: 'POST' })
    expect(imported.status).toBe(200)
    expect(await dumpData()).toEqual(before)
    expect(await countRows('exercises')).toBe(21)
    expect(await countRows('programs')).toBe(3)
    expect(await countRows('sessions')).toBe(106)
    expect(await countRows('sets')).toBe(2581)
  })
})

const upsertDirect = async () => {
  await upsertRows(env.jimbro, 'nikos', flattenRowSet(rowsFromExport(fixture as ExportShape)))
}

describe('auth', () => {
  it('answers 401 on every new route without a token', async () => {
    const routes = [
      ['POST', '/api/import-r2'],
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
