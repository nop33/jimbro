import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type MuscleGroup } from './muscleGroups'
import type { Exercise } from './stores/exercisesStore'
import type { Program } from './stores/programsStore'
import type { ExerciseExecution, ExerciseSetExecution, WorkoutSession } from './stores/workoutSessionsStore'

const LABEL_TO_SLUG = Object.fromEntries(
  (Object.entries(MUSCLE_GROUP_LABELS) as Array<[MuscleGroup, string]>).map(([slug, label]) => [label, slug])
) as Record<string, MuscleGroup>

export const normalizeMuscle = (value: string): MuscleGroup => {
  if ((MUSCLE_GROUPS as readonly string[]).includes(value)) return value as MuscleGroup
  if (LABEL_TO_SLUG[value]) return LABEL_TO_SLUG[value]
  return 'core'
}

export const upgradeExerciseRecord = (raw: Record<string, unknown>, now: string): Exercise => {
  const targetSets = typeof raw.targetSets === 'number' ? raw.targetSets : Number(raw.sets) || 0
  const targetReps = typeof raw.targetReps === 'number' ? raw.targetReps : Number(raw.reps) || 0

  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    muscle: normalizeMuscle(String(raw.muscle ?? '')),
    targetSets,
    targetReps,
    isDeleted: Boolean(raw.isDeleted),
    isRehab: Boolean(raw.isRehab),
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
  const sets = (Array.isArray(raw.sets) ? raw.sets : []) as Array<ExerciseSetExecution>
  const hasSnapshot = typeof raw.name === 'string' && typeof raw.targetSets === 'number'

  if (hasSnapshot) {
    return {
      exerciseId,
      name: raw.name as string,
      muscle: normalizeMuscle(String(raw.muscle ?? '')),
      targetSets: raw.targetSets as number,
      targetReps: typeof raw.targetReps === 'number' ? raw.targetReps : 0,
      isRehab: Boolean(raw.isRehab),
      sets
    }
  }

  const catalogEx = catalog.get(exerciseId)
  if (catalogEx) {
    let targetSets = catalogEx.targetSets
    if (sessionWasCompleted && sets.length < targetSets) {
      targetSets = Math.max(sets.length, 1)
    }
    return {
      exerciseId,
      name: catalogEx.name,
      muscle: catalogEx.muscle,
      targetSets,
      targetReps: catalogEx.targetReps,
      isRehab: catalogEx.isRehab,
      sets
    }
  }

  return {
    exerciseId,
    name: '(deleted)',
    muscle: 'core',
    targetSets: Math.max(sets.length, 1),
    targetReps: 0,
    isRehab: false,
    sets
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
