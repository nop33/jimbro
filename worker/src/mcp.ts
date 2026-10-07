import type { ExerciseRow, ProgramRow, SessionHeader, SetRow } from '../../src/db/types'
import { countStatements, type RowDatabase } from './rows'

const MAX_REV = `SELECT COALESCE(MAX(rev), 0) AS rev FROM (
  SELECT MAX(rev) AS rev FROM exercises WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM programs WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM sessions WHERE user_id = ?1
  UNION ALL
  SELECT MAX(rev) AS rev FROM sets WHERE user_id = ?1
)`

const RECENT_SQL = `SELECT data FROM sessions
WHERE user_id = ?1 AND json_extract(data, '$.isDeleted') = 0
ORDER BY date DESC, id ASC
LIMIT ?2`

const COUNTS_SQL = `SELECT session_id, exercise_id, COUNT(*) AS n FROM sets
WHERE user_id = ?1 AND json_extract(data, '$.isDeleted') = 0
AND session_id IN (SELECT value FROM json_each(?2))
GROUP BY session_id, exercise_id`

const SESSION_SQL = `SELECT data FROM sessions
WHERE user_id = ?1 AND id = ?2 AND json_extract(data, '$.isDeleted') = 0`

const SESSION_SETS_SQL = `SELECT data FROM sets
WHERE user_id = ?1 AND session_id = ?2 AND json_extract(data, '$.isDeleted') = 0`

const HISTORY_SESSIONS_SQL = `SELECT id, date FROM sessions
WHERE user_id = ?1 AND json_extract(data, '$.isDeleted') = 0
AND id IN (
  SELECT session_id FROM sets
  WHERE user_id = ?1 AND exercise_id = ?2 AND json_extract(data, '$.isDeleted') = 0
)
ORDER BY date DESC, id ASC
LIMIT ?3`

const HISTORY_SETS_SQL = `SELECT data FROM sets
WHERE user_id = ?1 AND exercise_id = ?2 AND json_extract(data, '$.isDeleted') = 0
AND session_id IN (SELECT value FROM json_each(?3))`

const EXERCISES_SQL = `SELECT data FROM exercises
WHERE user_id = ?1 AND json_extract(data, '$.isDeleted') = 0
ORDER BY id ASC`

const PROGRAMS_SQL = `SELECT data FROM programs
WHERE user_id = ?1 AND json_extract(data, '$.isDeleted') = 0
ORDER BY id ASC`

export const MCP_TOOLS = [
  {
    name: 'recent_sessions',
    description:
      'List the newest non-deleted workouts, newest first. Pass limit 3 for the last three. ' +
      'Each session is a header plus setCounts, the live set counts in exercise order.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'How many sessions to return'
        }
      }
    }
  },
  {
    name: 'get_session',
    description:
      'Return one non-deleted workout and its live sets. Sets follow the session exercise order, then position. ' +
      'A missing or deleted id returns session null and no sets.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Session id' }
      },
      required: ['id']
    }
  },
  {
    name: 'exercise_history',
    description:
      'Return live sets for one exercise, grouped by session, newest session first. ' +
      'limit is the maximum number of sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        exerciseId: { type: 'string', description: 'Exercise id' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
          description: 'How many sessions to return'
        }
      },
      required: ['exerciseId']
    }
  },
  {
    name: 'catalog',
    description: 'List non-deleted exercises and programs. Takes no arguments.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
] as const

type ToolName = (typeof MCP_TOOLS)[number]['name']
type RpcId = string | number | null

interface RecentPayload {
  revision: number
  sessions: Array<SessionHeader & { setCounts: number[] }>
}

interface SessionPayload {
  revision: number
  session: SessionHeader | null
  sets: SetRow[]
}

interface HistoryPayload {
  revision: number
  sessions: Array<{ sessionId: string; date: string; sets: SetRow[] }>
}

interface CatalogPayload {
  revision: number
  exercises: ExerciseRow[]
  programs: ProgramRow[]
}

type Parsed =
  | { tool: 'recent_sessions'; limit: number }
  | { tool: 'get_session'; id: string }
  | { tool: 'exercise_history'; exerciseId: string; limit: number }
  | { tool: 'catalog' }

interface CountRow {
  session_id: string
  exercise_id: string
  n: number
}

interface IdDate {
  id: string
  date: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const dataRows = (result: D1Result<unknown> | undefined) =>
  (result?.results ?? []).map((row) => JSON.parse(String((row as { data: string }).data)) as unknown)

const revisionOf = (result: D1Result<unknown> | undefined) => {
  const row = result?.results?.[0] as { rev?: unknown } | undefined
  return typeof row?.rev === 'number' ? row.rev : 0
}

const exerciseIndex = (header: SessionHeader | null, exerciseId: string) => {
  if (!header) return 0
  const index = header.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId)
  return index === -1 ? header.exercises.length : index
}

const jsonRpc = (
  request: Request,
  body: unknown,
  status: number,
  counted?: { statements: number; batches: number }
) => {
  const response = Response.json(body, { status })
  if (!counted || request.headers.get('x-d1-count') !== '1') return response
  const headers = new Headers(response.headers)
  headers.set('x-d1-statements', String(counted.statements))
  headers.set('x-d1-batches', String(counted.batches))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const rpcError = (request: Request, id: RpcId, code: number, message: string) =>
  jsonRpc(request, { jsonrpc: '2.0', id, error: { code, message } }, 200)

const rpcResult = (request: Request, id: RpcId, result: unknown, counted?: { statements: number; batches: number }) =>
  jsonRpc(request, { jsonrpc: '2.0', id, result }, 200, counted)

const toolResult = (
  request: Request,
  id: RpcId,
  payload: RecentPayload | SessionPayload | HistoryPayload | CatalogPayload,
  counted: { statements: number; batches: number }
) =>
  rpcResult(
    request,
    id,
    { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload },
    counted
  )

const limitArg = (args: Record<string, unknown>, max: number, fallback: number) => {
  if (!Object.hasOwn(args, 'limit')) return fallback
  const value = args.limit
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return null
  return value
}

const stringArg = (args: Record<string, unknown>, key: string) => {
  const value = args[key]
  if (typeof value !== 'string' || value === '') return null
  return value
}

const parseArgs = (name: ToolName, args: Record<string, unknown>): Parsed | null => {
  if (name === 'recent_sessions') {
    const limit = limitArg(args, 50, 10)
    return limit === null ? null : { tool: name, limit }
  }
  if (name === 'get_session') {
    const id = stringArg(args, 'id')
    return id === null ? null : { tool: name, id }
  }
  if (name === 'exercise_history') {
    const exerciseId = stringArg(args, 'exerciseId')
    const limit = limitArg(args, 100, 20)
    if (exerciseId === null || limit === null) return null
    return { tool: name, exerciseId, limit }
  }
  return { tool: 'catalog' }
}

const recentSessions = async (db: RowDatabase, userId: string, limit: number): Promise<RecentPayload> => {
  const listed = await db.batch([db.prepare(RECENT_SQL).bind(userId, limit)])
  const headers = dataRows(listed[0]) as SessionHeader[]
  const ids = JSON.stringify(headers.map((header) => header.id))
  // Counts need the header ids, so they are a second batch. Both batches together stay at three statements.
  const counted = await db.batch([db.prepare(COUNTS_SQL).bind(userId, ids), db.prepare(MAX_REV).bind(userId)])
  const counts = new Map<string, number>()
  for (const row of (counted[0]?.results ?? []) as CountRow[]) {
    counts.set(`${row.session_id}\0${row.exercise_id}`, Number(row.n))
  }
  return {
    revision: revisionOf(counted[1]),
    sessions: headers.map((header) => ({
      ...header,
      setCounts: header.exercises.map((exercise) => counts.get(`${header.id}\0${exercise.exerciseId}`) ?? 0)
    }))
  }
}

const getSession = async (db: RowDatabase, userId: string, id: string): Promise<SessionPayload> => {
  const results = await db.batch([
    db.prepare(SESSION_SQL).bind(userId, id),
    db.prepare(SESSION_SETS_SQL).bind(userId, id),
    db.prepare(MAX_REV).bind(userId)
  ])
  const header = (dataRows(results[0]) as SessionHeader[])[0] ?? null
  const sets = header
    ? (dataRows(results[1]) as SetRow[]).sort((left, right) => {
        const exercise = exerciseIndex(header, left.exerciseId) - exerciseIndex(header, right.exerciseId)
        if (exercise !== 0) return exercise
        return left.position - right.position
      })
    : []
  return { revision: revisionOf(results[2]), session: header, sets }
}

const exerciseHistory = async (
  db: RowDatabase,
  userId: string,
  exerciseId: string,
  limit: number
): Promise<HistoryPayload> => {
  const listed = await db.batch([db.prepare(HISTORY_SESSIONS_SQL).bind(userId, exerciseId, limit)])
  const sessions = (listed[0]?.results ?? []) as IdDate[]
  const ids = JSON.stringify(sessions.map((session) => session.id))
  const rest = await db.batch([
    db.prepare(HISTORY_SETS_SQL).bind(userId, exerciseId, ids),
    db.prepare(MAX_REV).bind(userId)
  ])
  const sets = dataRows(rest[0]) as SetRow[]
  return {
    revision: revisionOf(rest[1]),
    sessions: sessions.map((session) => ({
      sessionId: session.id,
      date: session.date,
      sets: sets.filter((set) => set.sessionId === session.id).sort((left, right) => left.position - right.position)
    }))
  }
}

const catalog = async (db: RowDatabase, userId: string): Promise<CatalogPayload> => {
  const results = await db.batch([
    db.prepare(EXERCISES_SQL).bind(userId),
    db.prepare(PROGRAMS_SQL).bind(userId),
    db.prepare(MAX_REV).bind(userId)
  ])
  return {
    revision: revisionOf(results[2]),
    exercises: dataRows(results[0]) as ExerciseRow[],
    programs: dataRows(results[1]) as ProgramRow[]
  }
}

const runTool = (parsed: Parsed, db: RowDatabase, userId: string) => {
  if (parsed.tool === 'recent_sessions') return recentSessions(db, userId, parsed.limit)
  if (parsed.tool === 'get_session') return getSession(db, userId, parsed.id)
  if (parsed.tool === 'exercise_history') return exerciseHistory(db, userId, parsed.exerciseId, parsed.limit)
  return catalog(db, userId)
}

const initializeResult = (params: unknown) => {
  const requested = isRecord(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
  return {
    protocolVersion: requested === '' ? '2025-06-18' : requested,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'jimbro', version: '1.0.0' },
    instructions:
      'Read-only workout history. Use recent_sessions for the latest workouts, get_session for one workout, ' +
      'exercise_history for one exercise, and catalog for exercises and programs.'
  }
}

const callTool = async (request: Request, database: D1Database, userId: string, id: RpcId, params: unknown) => {
  if (!isRecord(params) || typeof params.name !== 'string' || params.name === '') {
    return rpcError(request, id, -32602, 'Invalid params')
  }
  const name = MCP_TOOLS.find((tool) => tool.name === params.name)?.name
  if (!name) return rpcError(request, id, -32602, 'Unknown tool')
  const args = params.arguments === undefined ? {} : params.arguments
  if (!isRecord(args)) return rpcError(request, id, -32602, 'Invalid params')
  const parsed = parseArgs(name, args)
  if (!parsed) return rpcError(request, id, -32602, 'Invalid params')

  const counted = countStatements(database)
  const payload = await runTool(parsed, counted.db, userId)
  return toolResult(request, id, payload, { statements: counted.statements(), batches: counted.batches() })
}

export const handleMcp = async (request: Request, database: D1Database, userId: string): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return rpcError(request, null, -32700, 'Parse error')
  }
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(request, null, -32600, 'Invalid request')
  }

  const hasId = Object.hasOwn(body, 'id')
  if (hasId && body.id !== null && typeof body.id !== 'string' && typeof body.id !== 'number') {
    return rpcError(request, null, -32600, 'Invalid request')
  }
  if (!hasId || body.method.startsWith('notifications/')) return new Response(null, { status: 202 })

  const id = body.id as RpcId
  if (body.method === 'initialize') return rpcResult(request, id, initializeResult(body.params))
  if (body.method === 'tools/list') return rpcResult(request, id, { tools: MCP_TOOLS })
  if (body.method === 'tools/call') return callTool(request, database, userId, id, body.params)
  return rpcError(request, id, -32601, 'Method not found')
}
