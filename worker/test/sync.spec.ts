import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import january from '../../data-backup/gymbro-export-2026-01-02.json'
import type { ExportShape, Row } from '../../src/db/types'
import { rowsFromExport } from '../../src/sync/rows'
import { flattenRowSet, upsertRows } from '../src/rows'
import fixture from './fixtures/latest-v4.json'

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
    expect(await countRows('exercises')).toBe(0)
    expect(await countRows('sets')).toBe(0)
  })

  const expectInvalidExport = async (body: unknown) => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', JSON.stringify(body))
    const imported = await api('/api/import-r2', { method: 'POST' })
    expect(imported.status).toBe(400)
    expect(await imported.json()).toEqual({ error: 'invalid_export' })
    expect(await env.BACKUP_BUCKET.head('users/nikos/import.json')).toBeNull()
    expect(await countRows('exercises')).toBe(0)
    expect(await countRows('programs')).toBe(0)
    expect(await countRows('sessions')).toBe(0)
    expect(await countRows('sets')).toBe(0)
    const pushed = await push([{ table: 'exercises', row: exercise('squat', 'Squat') }])
    expect(pushed.status).toBe(409)
    expect(await pushed.json()).toEqual({ error: 'import_required' })
  }

  const snapshotShell = (workoutSessions: unknown[]) => ({
    version: 4,
    exportDate: '2026-04-12T00:00:00.000Z',
    stores: {
      exercises: [{ id: 'e1' }],
      programs: [{ id: 'p1' }],
      workoutSessions
    }
  })

  it('rejects a version 4 snapshot whose session is only an id', async () => {
    await expectInvalidExport(snapshotShell([{ id: 's1' }]))
  })

  it('rejects a version 4 snapshot whose session has exercises but no date', async () => {
    await expectInvalidExport(snapshotShell([{ id: 's1', exercises: [] }]))
  })

  it('rejects a version 4 snapshot whose set has no exerciseId', async () => {
    await expectInvalidExport(
      snapshotShell([
        {
          id: 's1',
          date: '2026-04-12',
          exercises: [{ sets: [{ preset: 'lifting', reps: 5, weight: 20 }] }]
        }
      ])
    )
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

  it('keeps every revision when import.json is deleted and the same file is imported again', async () => {
    await env.BACKUP_BUCKET.put('users/nikos/latest.json', JSON.stringify(file))
    const imported = await api('/api/import-r2', { method: 'POST' })
    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual({
      counts: { exercises: 21, programs: 3, sessions: 106, sets: 2581 },
      revision: 2711
    })
    const before = await dumpRevData()
    const revs = (['exercises', 'programs', 'sessions', 'sets'] as const)
      .flatMap((table) => before[table].map((row) => row.rev))
      .sort((left, right) => left - right)
    expect(revs).toEqual(Array.from({ length: 2711 }, (_, index) => index + 1))

    await env.BACKUP_BUCKET.delete('users/nikos/import.json')
    const again = await api('/api/import-r2', { method: 'POST' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({
      counts: { exercises: 21, programs: 3, sessions: 106, sets: 2581 },
      revision: 2711
    })
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
