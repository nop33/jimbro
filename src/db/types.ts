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
