import {
  coerceDefaults,
  defaultPresetForKind,
  hasSlot,
  kindOfPreset,
  parseExerciseKind,
  parseLogPreset,
  parseSet,
  type ExerciseDefaults,
  type ExerciseKind,
  type LogPreset
} from './exerciseLogging'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type MuscleGroup } from './muscleGroups'
import type { Exercise } from './stores/exercisesStore'
import type { Program } from './stores/programsStore'
import type { ExerciseExecution, WorkoutSession } from './stores/workoutSessionsStore'

const LABEL_TO_SLUG = Object.fromEntries(
  (Object.entries(MUSCLE_GROUP_LABELS) as Array<[MuscleGroup, string]>).map(([slug, label]) => [label, slug])
) as Record<string, MuscleGroup>

export const normalizeMuscle = (value: string): MuscleGroup => {
  if ((MUSCLE_GROUPS as readonly string[]).includes(value)) return value as MuscleGroup
  if (LABEL_TO_SLUG[value]) return LABEL_TO_SLUG[value]
  return 'core'
}

interface Logging {
  kind: ExerciseKind
  preset: LogPreset
}

const upgradeLogging = (raw: Record<string, unknown>): Logging => {
  const preset = parseLogPreset(raw.preset)
  if (preset) return { kind: parseExerciseKind(raw.kind) ?? kindOfPreset(preset), preset }

  const kind = parseExerciseKind(raw.kind) ?? (raw.isRehab ? 'rehab' : 'lifting')
  return { kind, preset: defaultPresetForKind(kind) }
}

const upgradeDefaults = (raw: Record<string, unknown>, preset: LogPreset, legacyReps: number): ExerciseDefaults => {
  const defaults = coerceDefaults(preset, raw.defaults)
  if (defaults.reps === undefined && hasSlot(preset, 'reps')) defaults.reps = legacyReps
  return defaults
}

const upgradeMuscle = (raw: Record<string, unknown>, kind: ExerciseKind): MuscleGroup | undefined => {
  if (kind !== 'cardio') return normalizeMuscle(String(raw.muscle ?? ''))
  return typeof raw.muscle === 'string' && raw.muscle !== '' ? normalizeMuscle(raw.muscle) : undefined
}

const legacyRepsOf = (raw: Record<string, unknown>): number =>
  typeof raw.targetReps === 'number' ? raw.targetReps : Number(raw.reps) || 0

export const upgradeExerciseRecord = (raw: Record<string, unknown>, now: string): Exercise => {
  const { kind, preset } = upgradeLogging(raw)

  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    kind,
    preset,
    muscle: upgradeMuscle(raw, kind),
    targetSets: typeof raw.targetSets === 'number' ? raw.targetSets : Number(raw.sets) || 0,
    defaults: upgradeDefaults(raw, preset, legacyRepsOf(raw)),
    isDeleted: Boolean(raw.isDeleted),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

export const upgradeProgramRecord = (raw: Record<string, unknown>, now: string): Program => ({
  id: String(raw.id),
  name: String(raw.name ?? ''),
  exercises: Array.isArray(raw.exercises) ? raw.exercises.map((id) => String(id)) : [],
  isDeleted: Boolean(raw.isDeleted),
  updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
})

const upgradeSessionExercise = (
  raw: Record<string, unknown>,
  catalog: Map<string, Exercise>,
  sessionWasCompleted: boolean
): ExerciseExecution => {
  const exerciseId = String(raw.exerciseId ?? '')
  const rawSets = Array.isArray(raw.sets) ? raw.sets : []
  const hasSnapshot = typeof raw.name === 'string' && typeof raw.targetSets === 'number'

  if (hasSnapshot) {
    const { kind, preset } = upgradeLogging(raw)
    return {
      exerciseId,
      name: raw.name as string,
      kind,
      preset,
      muscle: upgradeMuscle(raw, kind),
      targetSets: raw.targetSets as number,
      defaults: upgradeDefaults(raw, preset, legacyRepsOf(raw)),
      sets: rawSets.map((set) => parseSet(set, preset))
    }
  }

  const catalogEx = catalog.get(exerciseId)
  if (catalogEx) {
    let targetSets = catalogEx.targetSets
    if (sessionWasCompleted && rawSets.length < targetSets) {
      targetSets = Math.max(rawSets.length, 1)
    }
    return {
      exerciseId,
      name: catalogEx.name,
      kind: catalogEx.kind,
      preset: catalogEx.preset,
      muscle: catalogEx.muscle,
      targetSets,
      defaults: { ...catalogEx.defaults },
      sets: rawSets.map((set) => parseSet(set, catalogEx.preset))
    }
  }

  return {
    exerciseId,
    name: '(deleted)',
    kind: 'lifting',
    preset: 'lifting',
    muscle: 'core',
    targetSets: Math.max(rawSets.length, 1),
    defaults: {},
    sets: rawSets.map((set) => parseSet(set, 'lifting'))
  }
}

export const upgradeWorkoutSessionRecord = (
  raw: Record<string, unknown>,
  catalog: Map<string, Exercise>,
  now: string
): WorkoutSession => {
  const storedStatus = raw.status === 'completed' ? 'completed' : 'incomplete'
  const exercisesIn = Array.isArray(raw.exercises) ? raw.exercises : []

  return {
    id: String(raw.id ?? ''),
    date: String(raw.date ?? ''),
    programId: String(raw.programId ?? ''),
    exercises: exercisesIn.map((item) =>
      upgradeSessionExercise(item as Record<string, unknown>, catalog, storedStatus === 'completed')
    ),
    location: typeof raw.location === 'string' ? raw.location : '',
    status: storedStatus,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}
