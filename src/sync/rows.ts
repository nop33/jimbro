import type { ExerciseDefaults, ExerciseKind, ExerciseSetExecution, LogPreset } from '../db/exerciseLogging'
import type { MuscleGroup } from '../db/muscleGroups'

export const ROW_TABLES = ['exercises', 'programs', 'sessions', 'sets'] as const
export type RowTable = (typeof ROW_TABLES)[number]

export interface ExerciseRow {
  id: string
  name: string
  kind: ExerciseKind
  preset: LogPreset
  muscle?: MuscleGroup
  targetSets: number
  defaults: ExerciseDefaults
  isDeleted: boolean
  updatedAt: string
}

export interface ProgramRow {
  id: string
  name: string
  exercises: Array<ExerciseRow['id']>
  isDeleted: boolean
  updatedAt: string
}

export type ExerciseSnapshot = Pick<ExerciseRow, 'name' | 'kind' | 'preset' | 'muscle' | 'targetSets' | 'defaults'> & {
  exerciseId: ExerciseRow['id']
}

export interface SessionHeader {
  id: string
  date: string
  programId: ProgramRow['id']
  location: string
  status: 'completed' | 'incomplete'
  notes?: string
  exercises: Array<ExerciseSnapshot>
  isDeleted: boolean
  updatedAt: string
}

export interface SetRow {
  id: string
  sessionId: SessionHeader['id']
  exerciseId: ExerciseRow['id']
  position: number
  set: ExerciseSetExecution
  isDeleted: boolean
  updatedAt: string
}

export type Row =
  | { table: 'exercises'; row: ExerciseRow }
  | { table: 'programs'; row: ProgramRow }
  | { table: 'sessions'; row: SessionHeader }
  | { table: 'sets'; row: SetRow }

export const legacySetId = (sessionId: string, exerciseId: string, position: number) =>
  `${sessionId}:${exerciseId}:${position}`

export interface NestedSession {
  id: string
  date: string
  programId: string
  location: string
  status: SessionHeader['status']
  notes?: string
  exercises: Array<ExerciseSnapshot & { sets?: Array<ExerciseSetExecution> }>
  isDeleted?: boolean
  updatedAt: string
}

export interface AssembledSession {
  id: string
  date: string
  programId: string
  location: string
  status: SessionHeader['status']
  notes?: string
  exercises: Array<ExerciseSnapshot & { sets: Array<ExerciseSetExecution> }>
  updatedAt: string
}

export interface ExportShape {
  version: number
  exportDate: string
  stores: {
    exercises: Array<ExerciseRow>
    programs: Array<ProgramRow>
    workoutSessions: Array<NestedSession>
  }
}

export interface ExportedFile {
  version: number
  exportDate: string
  stores: {
    exercises: Array<ExerciseRow>
    programs: Array<ProgramRow>
    workoutSessions: Array<AssembledSession>
  }
}

export interface RowSet {
  version: number
  exportDate: string
  exercises: Array<ExerciseRow>
  programs: Array<ProgramRow>
  sessions: Array<SessionHeader>
  sets: Array<SetRow>
}

const canonical = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

export const rowsEqual = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right)

const snapshotOf = (exercise: ExerciseSnapshot & { sets?: Array<ExerciseSetExecution> }): ExerciseSnapshot => {
  const snapshot = { ...exercise }
  delete snapshot.sets
  return snapshot
}

export const rowsFromSession = (session: NestedSession): { header: SessionHeader; sets: Array<SetRow> } => {
  const header: SessionHeader = {
    id: session.id,
    date: session.date,
    programId: session.programId,
    location: session.location,
    status: session.status,
    exercises: session.exercises.map((exercise) => snapshotOf(exercise)),
    isDeleted: session.isDeleted ?? false,
    updatedAt: session.updatedAt
  }
  if ('notes' in session) header.notes = session.notes

  const sets: Array<SetRow> = []
  for (const exercise of session.exercises) {
    for (const [position, set] of (exercise.sets ?? []).entries()) {
      sets.push({
        id: legacySetId(session.id, exercise.exerciseId, position),
        sessionId: session.id,
        exerciseId: exercise.exerciseId,
        position,
        set,
        isDeleted: false,
        updatedAt: session.updatedAt
      })
    }
  }
  return { header, sets }
}

export const sessionFromRows = (header: SessionHeader, sets: ReadonlyArray<SetRow>): AssembledSession => {
  const setsByExercise = new Map<string, Array<ExerciseSetExecution>>()
  const live = sets.filter((set) => !set.isDeleted).sort((left, right) => left.position - right.position)
  for (const set of live) {
    const group = setsByExercise.get(set.exerciseId)
    if (group) group.push(set.set)
    else setsByExercise.set(set.exerciseId, [set.set])
  }

  const session: AssembledSession = {
    id: header.id,
    date: header.date,
    programId: header.programId,
    location: header.location,
    status: header.status,
    exercises: header.exercises.map((exercise) => ({
      ...exercise,
      sets: setsByExercise.get(exercise.exerciseId) ?? []
    })),
    updatedAt: header.updatedAt
  }
  if ('notes' in header) session.notes = header.notes
  return session
}

export const rowsFromExport = (data: ExportShape): RowSet => {
  const sessions: Array<SessionHeader> = []
  const sets: Array<SetRow> = []
  for (const session of data.stores.workoutSessions) {
    const split = rowsFromSession(session)
    sessions.push(split.header)
    sets.push(...split.sets)
  }
  return {
    version: data.version,
    exportDate: data.exportDate,
    exercises: data.stores.exercises,
    programs: data.stores.programs,
    sessions,
    sets
  }
}

export const exportFromRows = (rows: RowSet): ExportedFile => {
  const setsBySession = new Map<string, Array<SetRow>>()
  for (const set of rows.sets) {
    const list = setsBySession.get(set.sessionId)
    if (list) list.push(set)
    else setsBySession.set(set.sessionId, [set])
  }

  return {
    version: rows.version,
    exportDate: rows.exportDate,
    stores: {
      exercises: rows.exercises,
      programs: rows.programs,
      workoutSessions: rows.sessions
        .filter((header) => !header.isDeleted)
        .map((header) => sessionFromRows(header, setsBySession.get(header.id) ?? []))
    }
  }
}
