import { setValues, type ExerciseDefaults } from '../../db/exerciseLogging'
import { workoutSessionsStore, type LastTime } from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'

export interface ExercisePlan {
  // As many sets as the exercise asks for, as last time had, or as the session already holds, whichever is most.
  targetSets: number
  // The next set's form: the session's latest set, else last time's values with its heaviest weight.
  prefill: ExerciseDefaults
  lastTime: LastTime | undefined
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
    targetSets: Math.max(snapshot.targetSets, lastTime?.sets.length ?? 0, sets.length),
    prefill: prefill(snapshot, sets.at(-1), lastTime),
    lastTime
  }
}

const prefill = (
  { preset, defaults }: ExerciseSnapshot,
  currentSet: LastTime['sets'][number] | undefined,
  lastTime: LastTime | undefined
): ExerciseDefaults => {
  if (currentSet) return { ...defaults, ...setValues(currentSet) }

  const previousSets = (lastTime?.sets ?? []).filter((set) => set.preset === preset)
  const previousSet = previousSets.at(-1)
  const values = previousSet ? { ...defaults, ...setValues(previousSet) } : { ...defaults }

  if (preset === 'lifting' && previousSets.length > 0) {
    const maxWeight = Math.max(...previousSets.map((set) => setValues(set).weight ?? 0))
    if (maxWeight > 0) values.weight = maxWeight
  }

  if (preset === 'cardioTreadmill' && values.incline === undefined) values.incline = 0

  return values
}
