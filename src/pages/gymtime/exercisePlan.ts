import { setValues, type ExerciseDefaults, type ExerciseSetExecution } from '../../db/exerciseLogging'
import { workoutSessionsStore, type LastTime } from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'

export interface ExercisePlan {
  // In a session, its stored target, or the sets it already holds when more. Before one starts, the target a new
  // session will store.
  targetSets: number
  // The next set's form, from nextSetValues.
  prefill: ExerciseDefaults
  // The prefilled weight is the heaviest of last time's differing weights.
  prefillIsMax: boolean
  lastTime: LastTime | undefined
}

// Where a session is, or will be, done.
type Where = Pick<WorkoutSession, 'date' | 'location'> & { id?: WorkoutSession['id'] }

// The target a session stores for the exercise when it starts or the exercise joins it: as many sets as the exercise
// asks for, or as last time had when more.
export async function startingTargetSets(snapshot: ExerciseSnapshot, where: Where): Promise<number> {
  const lastTime = await workoutSessionsStore.lastTimeOf(snapshot.exerciseId, where)
  return Math.max(snapshot.targetSets, lastTime?.sets.length ?? 0)
}

// What an exercise card shows for the exercise in the session, or in the program before a session starts. Every
// part comes from one read of last time, which never returns the session itself.
export async function planExercise(
  snapshot: ExerciseSnapshot,
  session: WorkoutSession | undefined
): Promise<ExercisePlan> {
  const lastTime = await workoutSessionsStore.lastTimeOf(snapshot.exerciseId, session)
  const sets = session?.exercises.find(({ exerciseId }) => exerciseId === snapshot.exerciseId)?.sets ?? []

  return {
    targetSets: Math.max(snapshot.targetSets, sets.length, session ? 0 : (lastTime?.sets.length ?? 0)),
    prefill: nextSetValues(snapshot, sets, lastTime),
    prefillIsMax: prefillIsMaxWeight(snapshot, sets, lastTime),
    lastTime
  }
}

// The next set's values: today's latest set, else last time's last set with the heaviest weight of last time for
// lifting, else the exercise's defaults.
export const nextSetValues = (
  { preset, defaults }: ExerciseSnapshot,
  today: ReadonlyArray<ExerciseSetExecution>,
  lastTime: LastTime | undefined
): ExerciseDefaults => {
  const latest = today.at(-1)
  if (latest) return { ...defaults, ...setValues(latest) }

  const previous = previousSetsOf(preset, lastTime)
  const values = { ...defaults, ...previous.at(-1) }
  const heaviest = maxWeight(previous)
  if (preset === 'lifting' && heaviest > 0) values.weight = heaviest
  if (preset === 'cardioTreadmill' && values.incline === undefined) values.incline = 0

  return values
}

// Whether the prefilled weight is last time's heaviest out of several, so the form says so. With no set today and
// every set of last time at one weight, there is nothing to tell.
export const prefillIsMaxWeight = (
  { preset }: ExerciseSnapshot,
  today: ReadonlyArray<ExerciseSetExecution>,
  lastTime: LastTime | undefined
): boolean => {
  if (preset !== 'lifting' || today.length > 0) return false
  const weights = new Set(previousSetsOf(preset, lastTime).map((set) => set.weight ?? 0))
  return weights.size > 1
}

const previousSetsOf = (preset: ExerciseSnapshot['preset'], lastTime: LastTime | undefined) =>
  (lastTime?.sets ?? []).filter((set) => set.preset === preset).map(setValues)

const maxWeight = (sets: ReadonlyArray<ExerciseDefaults>) => Math.max(0, ...sets.map((set) => set.weight ?? 0))
