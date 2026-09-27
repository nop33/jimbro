import {
  ROW_TABLES,
  exportFromRows,
  rowsFromExport,
  type ExerciseRow,
  type ExportShape,
  type ProgramRow,
  type Row,
  type RowSet,
  type RowTable,
  type SessionHeader,
  type SetRow
} from '../../src/sync/rows'

export { exportFromRows, rowsFromExport }
export type { ExportShape, Row, RowSet, RowTable }

export const ROW_LIMIT = 1000

const KINDS = new Set(['lifting', 'rehab', 'cardio'])
const PRESETS = new Set(['lifting', 'rehabReps', 'rehabHold', 'cardioTreadmill'])
const MUSCLES = new Set([
  'quads',
  'calves',
  'hamstrings',
  'glutes',
  'chest',
  'biceps',
  'triceps',
  'shoulders',
  'traps',
  'back',
  'core'
])
const STATUSES = new Set(['completed', 'incomplete'])

const MAX_REV = `SELECT COALESCE(MAX(rev), 0) AS rev FROM (
  SELECT MAX(rev) AS rev FROM exercises WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM programs WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM sessions WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM sets WHERE user_id = ?1
)`

// WHERE 1 stops SQLite from parsing ON CONFLICT as a join condition.
const insertSql = (table: RowTable, columns: string, selected: string, update: string) => `WITH base AS (${MAX_REV})
INSERT INTO ${table} (${columns})
SELECT ${selected}
FROM json_each(?2) AS j
WHERE 1
ON CONFLICT(user_id, id) DO UPDATE SET ${update}`

const revExpr = '(SELECT rev FROM base) + CAST(j.key AS INTEGER) + 1'

const INSERT_SQL: Record<RowTable, string> = {
  exercises: insertSql(
    'exercises',
    'user_id, id, rev, data',
    `?1, json_extract(j.value, '$.id'), ${revExpr}, json(j.value)`,
    'rev = excluded.rev, data = excluded.data'
  ),
  programs: insertSql(
    'programs',
    'user_id, id, rev, data',
    `?1, json_extract(j.value, '$.id'), ${revExpr}, json(j.value)`,
    'rev = excluded.rev, data = excluded.data'
  ),
  sessions: insertSql(
    'sessions',
    'user_id, id, rev, date, data',
    `?1, json_extract(j.value, '$.id'), ${revExpr}, json_extract(j.value, '$.date'), json(j.value)`,
    'rev = excluded.rev, date = excluded.date, data = excluded.data'
  ),
  sets: insertSql(
    'sets',
    'user_id, id, rev, session_id, exercise_id, data',
    `?1, json_extract(j.value, '$.id'), ${revExpr}, json_extract(j.value, '$.sessionId'), json_extract(j.value, '$.exerciseId'), json(j.value)`,
    'rev = excluded.rev, session_id = excluded.session_id, exercise_id = excluded.exercise_id, data = excluded.data'
  )
}

const PULL_SQL = `SELECT table_name, rev, data FROM (
  SELECT 'exercises' AS table_name, rev, data FROM exercises WHERE user_id = ?1 AND rev > ?2
  UNION ALL
  SELECT 'programs', rev, data FROM programs WHERE user_id = ?1 AND rev > ?2
  UNION ALL
  SELECT 'sessions', rev, data FROM sessions WHERE user_id = ?1 AND rev > ?2
  UNION ALL
  SELECT 'sets', rev, data FROM sets WHERE user_id = ?1 AND rev > ?2
)
ORDER BY rev ASC
LIMIT ?3`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isRowTable = (value: string): value is RowTable => (ROW_TABLES as readonly string[]).includes(value)

const isDefaults = (value: unknown) => isRecord(value) && Object.values(value).every((item) => isFiniteNumber(item))

const isSnapshot = (value: unknown) => {
  if (!isRecord(value)) return false
  if (!isString(value.exerciseId) || value.exerciseId === '') return false
  if (!isString(value.name)) return false
  if (!isString(value.kind) || !KINDS.has(value.kind)) return false
  if (!isString(value.preset) || !PRESETS.has(value.preset)) return false
  if (value.muscle !== undefined && (!isString(value.muscle) || !MUSCLES.has(value.muscle))) return false
  if (!isFiniteNumber(value.targetSets) || !isDefaults(value.defaults)) return false
  return true
}

const isSetExecution = (value: unknown) => {
  if (!isRecord(value) || !isString(value.preset)) return false
  const weightOk = value.weight === undefined || isFiniteNumber(value.weight)
  if (value.preset === 'lifting') return isFiniteNumber(value.reps) && isFiniteNumber(value.weight)
  if (value.preset === 'rehabReps') return isFiniteNumber(value.reps) && weightOk
  if (value.preset === 'rehabHold') return isFiniteNumber(value.durationSec) && weightOk
  if (value.preset === 'cardioTreadmill') {
    return isFiniteNumber(value.durationSec) && isFiniteNumber(value.speed) && isFiniteNumber(value.incline)
  }
  return false
}

const isExercise = (row: unknown): row is ExerciseRow =>
  isRecord(row) &&
  isString(row.id) &&
  row.id !== '' &&
  isString(row.name) &&
  isString(row.kind) &&
  KINDS.has(row.kind) &&
  isString(row.preset) &&
  PRESETS.has(row.preset) &&
  (row.muscle === undefined || (isString(row.muscle) && MUSCLES.has(row.muscle))) &&
  isFiniteNumber(row.targetSets) &&
  isDefaults(row.defaults) &&
  isBoolean(row.isDeleted) &&
  isString(row.updatedAt)

const isProgram = (row: unknown): row is ProgramRow =>
  isRecord(row) &&
  isString(row.id) &&
  row.id !== '' &&
  isString(row.name) &&
  Array.isArray(row.exercises) &&
  row.exercises.every((id) => isString(id) && id !== '') &&
  isBoolean(row.isDeleted) &&
  isString(row.updatedAt)

const isSession = (row: unknown): row is SessionHeader =>
  isRecord(row) &&
  isString(row.id) &&
  row.id !== '' &&
  isString(row.date) &&
  isString(row.programId) &&
  isString(row.location) &&
  isString(row.status) &&
  STATUSES.has(row.status) &&
  (row.notes === undefined || isString(row.notes)) &&
  Array.isArray(row.exercises) &&
  row.exercises.every((exercise) => isSnapshot(exercise)) &&
  isBoolean(row.isDeleted) &&
  isString(row.updatedAt)

const isSet = (row: unknown): row is SetRow =>
  isRecord(row) &&
  isString(row.id) &&
  row.id !== '' &&
  isString(row.sessionId) &&
  row.sessionId !== '' &&
  isString(row.exerciseId) &&
  row.exerciseId !== '' &&
  isFiniteNumber(row.position) &&
  isSetExecution(row.set) &&
  isBoolean(row.isDeleted) &&
  isString(row.updatedAt)

const parseEntry = (value: unknown): Row | null => {
  if (!isRecord(value) || !isString(value.table) || !isRowTable(value.table) || !isRecord(value.row)) return null
  if (value.table === 'exercises') return isExercise(value.row) ? { table: 'exercises', row: value.row } : null
  if (value.table === 'programs') return isProgram(value.row) ? { table: 'programs', row: value.row } : null
  if (value.table === 'sessions') return isSession(value.row) ? { table: 'sessions', row: value.row } : null
  return isSet(value.row) ? { table: 'sets', row: value.row } : null
}

export type PushBody = { ok: true; rows: Row[] } | { ok: false; index: number } | { ok: false; error: 'too_many_rows' }

export const parsePushBody = (body: unknown): PushBody => {
  if (!isRecord(body) || !Array.isArray(body.rows)) return { ok: false, index: 0 }
  if (body.rows.length > ROW_LIMIT) return { ok: false, error: 'too_many_rows' }
  const rows: Row[] = []
  for (let index = 0; index < body.rows.length; index++) {
    const row = parseEntry(body.rows[index])
    if (!row) return { ok: false, index }
    rows.push(row)
  }
  return { ok: true, rows }
}

const isExportFile = (value: unknown): value is ExportShape => {
  if (!isRecord(value) || value.version !== 4 || !isString(value.exportDate) || !isRecord(value.stores)) return false
  const exercises = value.stores.exercises
  const programs = value.stores.programs
  const workoutSessions = value.stores.workoutSessions
  if (!Array.isArray(exercises) || !Array.isArray(programs) || !Array.isArray(workoutSessions)) return false
  return workoutSessions.every((session) => isRecord(session) && isString(session.id) && session.id !== '')
}

export const parseExportFile = (value: unknown): ExportShape | null => (isExportFile(value) ? value : null)

export interface ImportMarker {
  exportDate: string
  importedAt: string
  counts: Record<RowTable, number>
}

export const countsOf = (rows: RowSet): Record<RowTable, number> => ({
  exercises: rows.exercises.length,
  programs: rows.programs.length,
  sessions: rows.sessions.length,
  sets: rows.sets.length
})

export const flattenRowSet = (rows: RowSet): Row[] => [
  ...rows.exercises.map((row) => ({ table: 'exercises' as const, row })),
  ...rows.programs.map((row) => ({ table: 'programs' as const, row })),
  ...rows.sessions.map((row) => ({ table: 'sessions' as const, row })),
  ...rows.sets.map((row) => ({ table: 'sets' as const, row }))
]

export interface RowDatabase {
  prepare: D1Database['prepare']
  batch: D1Database['batch']
}

export interface CountedDatabase {
  db: RowDatabase
  statements: () => number
  batches: () => number
}

export const countStatements = (inner: D1Database): CountedDatabase => {
  let statements = 0
  let batches = 0
  const db: RowDatabase = {
    prepare: (query: string) => inner.prepare(query),
    batch: (list) => {
      batches += 1
      statements += list.length
      return inner.batch(list)
    }
  }
  return { db, statements: () => statements, batches: () => batches }
}

const chunksOf = (rows: Row[]) => {
  const chunks: Array<{ table: RowTable; rows: Array<Row['row']> }> = []
  for (const entry of rows) {
    const last = chunks.at(-1)
    if (!last || last.table !== entry.table || last.rows.length >= ROW_LIMIT) {
      chunks.push({ table: entry.table, rows: [entry.row] })
    } else last.rows.push(entry.row)
  }
  return chunks
}

const revisionFrom = (results: D1Result<unknown>[]) => {
  const rev = results.at(-1)?.results?.[0]
  if (!rev || typeof rev !== 'object' || !('rev' in rev)) return 0
  return typeof rev.rev === 'number' ? rev.rev : 0
}

export const upsertRows = async (db: RowDatabase, userId: string, rows: Row[]): Promise<number> => {
  const statements = chunksOf(rows).map((chunk) =>
    db.prepare(INSERT_SQL[chunk.table]).bind(userId, JSON.stringify(chunk.rows))
  )
  statements.push(db.prepare(MAX_REV).bind(userId))
  const results = await db.batch(statements)
  return revisionFrom(results)
}

interface StoredPull {
  table_name: string
  rev: number
  data: string
}

const parseStored = (data: string) => JSON.parse(data) as Row['row']

export const pullRows = async (db: RowDatabase, userId: string, cursor: number, limit: number) => {
  const results = await db.batch<StoredPull>([db.prepare(PULL_SQL).bind(userId, cursor, limit + 1)])
  const raw = results[0]?.results ?? []
  const more = raw.length > limit
  const page = more ? raw.slice(0, limit) : raw
  const rows = page.flatMap((item) => {
    if (!isRowTable(item.table_name)) return []
    const table = item.table_name
    return [{ table, row: parseStored(item.data), rev: item.rev } as Row & { rev: number }]
  })
  const nextCursor = page.length > 0 ? page[page.length - 1].rev : cursor
  return { rows, cursor: nextCursor, more }
}

export const loadRowSet = async (
  db: RowDatabase,
  userId: string,
  version: number,
  exportDate: string
): Promise<RowSet> => {
  const results = await db.batch<{ data: string }>(
    ROW_TABLES.map((table) => db.prepare(`SELECT data FROM ${table} WHERE user_id = ?1 ORDER BY id`).bind(userId))
  )
  const read = (index: number) => (results[index]?.results ?? []).map((item) => parseStored(item.data))
  return {
    version,
    exportDate,
    exercises: read(0) as ExerciseRow[],
    programs: read(1) as ProgramRow[],
    sessions: read(2) as SessionHeader[],
    sets: read(3) as SetRow[]
  }
}
