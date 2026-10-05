import type { ExerciseDefaults, ExerciseKind, ExerciseSetExecution, LogPreset } from './exerciseLogging'
import type { MuscleGroup } from './muscleGroups'

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

export const SESSION_STATUSES = ['completed', 'incomplete'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export interface SessionHeader {
  id: string
  date: string
  programId: ProgramRow['id']
  location: string
  status: SessionStatus
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

export type ExerciseExecution = ExerciseSnapshot & { sets: Array<ExerciseSetExecution> }

// A session header joined with each exercise's live sets, in position order.
export type WorkoutSession = Omit<SessionHeader, 'exercises' | 'isDeleted'> & { exercises: Array<ExerciseExecution> }

// A session the way an export file nests it, with the sets inside each exercise.
export type NestedSession = Omit<SessionHeader, 'exercises' | 'isDeleted'> & {
  exercises: Array<ExerciseSnapshot & { sets?: Array<ExerciseSetExecution> }>
  isDeleted?: boolean
}

interface ExportFile<Session> {
  version: number
  exportDate: string
  stores: {
    exercises: Array<ExerciseRow>
    programs: Array<ProgramRow>
    workoutSessions: Array<Session>
  }
}

// What an import accepts.
export type ExportShape = ExportFile<NestedSession>

// What an export writes.
export type ExportedFile = ExportFile<WorkoutSession>

export interface RowSet {
  version: number
  exportDate: string
  exercises: Array<ExerciseRow>
  programs: Array<ProgramRow>
  sessions: Array<SessionHeader>
  sets: Array<SetRow>
}
