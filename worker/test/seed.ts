import { env } from 'cloudflare:test'
import { rowsFromExport, type ExportShape, type Row } from '../../src/sync/rows'
import { upsertRows } from '../src/rows'

// Every row of an export file, in the shape /api/push takes.
export const rowsOf = (file: ExportShape): Row[] => {
  const rows = rowsFromExport(file)
  return [
    ...rows.exercises.map((row) => ({ table: 'exercises' as const, row })),
    ...rows.programs.map((row) => ({ table: 'programs' as const, row })),
    ...rows.sessions.map((row) => ({ table: 'sessions' as const, row })),
    ...rows.sets.map((row) => ({ table: 'sets' as const, row }))
  ]
}

// Writes an export file's rows straight into D1 for the test user and returns the latest revision.
export const seedExport = (file: ExportShape) => upsertRows(env.jimbro, 'nikos', rowsOf(file))
