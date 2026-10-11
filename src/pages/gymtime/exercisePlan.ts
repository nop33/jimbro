import { setValues, type ExerciseDefaults, type ExerciseSetExecution } from '../../db/exerciseLogging'
import {
  progressOf,
  startingTargetSets,
  workoutSessionsStore,
  type ExerciseProgress,
  type LastTime,
  type PlannedSession
} from '../../db/stores/workoutSessionsStore'
import type { ExerciseExecution, ExerciseSnapshot, WorkoutSession } from '../../db/types'

export interface ExercisePlan {
  // In a session, the exercise's progress there. Before one starts, no sets yet of the target the start will store.
  progress: ExerciseProgress
  // The next set's form, from nextSetValues.
  prefill: ExerciseDefaults
  // The prefilled weight is the heaviest of last time's differing weights.
  prefillIsMax: boolean
  lastTime: LastTime | undefined
}

export type ReadLastTime = (
  exerciseId: ExerciseSnapshot['exerciseId'],
  session: PlannedSession & { id?: WorkoutSession['id'] }
) => Promise<LastTime | undefined>

const readFromStore: ReadLastTime = (exerciseId, session) => workoutSessionsStore.lastTimeOf(exerciseId, session)

// A ReadLastTime that reads each exercise's last time once for a workout, day and gym, and keeps it. This page's
// writes change only the open workout, which last time never is, so what it keeps goes stale only when a pull or
// another tab changes an earlier workout. forget() drops it all then.
export const keptLastTimes = (): { read: ReadLastTime; forget: () => void } => {
  const kept = new Map<string, Promise<LastTime | undefined>>()
  return {
    read: (exerciseId, session) => {
      const key = JSON.stringify([exerciseId, session.id ?? '', session.date, session.location])
      let lastTime = kept.get(key)
      if (!lastTime) {
        lastTime = readFromStore(exerciseId, session)
        kept.set(key, lastTime)
        // A failed read is tried again next time.
        lastTime.catch(() => kept.delete(key))
      }
      return lastTime
    },
    forget: () => kept.clear()
  }
}

// What an exercise card shows for the exercise in the session, or in the program before a session starts on the
// planned day at the planned gym. Every part comes from one read of last time, which never returns the session
// itself. A planned session reads the same last time its start will, so it shows the target the start stores.
// readLastTime stands in for the store's read, such as one that keeps what it read.
export async function planExercise(
  snapshot: ExerciseSnapshot,
  session: WorkoutSession | PlannedSession,
  readLastTime: ReadLastTime = readFromStore
): Promise<ExercisePlan> {
  const lastTime = await readLastTime(snapshot.exerciseId, session)
  const exercise: Pick<ExerciseExecution, 'targetSets' | 'sets'> = ('exercises' in session
    ? session.exercises.find(({ exerciseId }) => exerciseId === snapshot.exerciseId)
    : undefined) ?? { targetSets: startingTargetSets(snapshot, lastTime), sets: [] }

  return {
    progress: progressOf(exercise),
    prefill: nextSetValues(snapshot, exercise.sets, lastTime),
    prefillIsMax: prefillIsMaxWeight(snapshot, exercise.sets, lastTime),
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
