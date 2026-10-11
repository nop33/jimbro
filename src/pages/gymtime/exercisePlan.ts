import { setValues, type ExerciseDefaults, type ExerciseSetExecution } from '../../db/exerciseLogging'
import { workoutSessionsStore, type LastTime } from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'

export interface ExercisePlan {
  // In a session, its stored target, or the sets it already holds when more. Before one starts, the target a new
  // session will store.
  targetSets: number
  // The next set's form, from nextSetValues.
  prefill: ExerciseDefaults
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
    lastTime
  }
}

// The values the next set most likely has, so that logging it as done takes one tap. Set N repeats set N of last
// time, moved by the weight change today's set before it made against last time's. Past last time's sets, it
// repeats today's latest set. With no last time, the first set takes the exercise's defaults.
export const nextSetValues = (
  { preset, defaults }: ExerciseSnapshot,
  today: ReadonlyArray<ExerciseSetExecution>,
  lastTime: LastTime | undefined
): ExerciseDefaults => {
  const previous = (lastTime?.sets ?? []).filter((set) => set.preset === preset).map(setValues)
  const done = today.map(setValues)
  const position = done.length
  const latest = done.at(-1)

  let values: ExerciseDefaults
  if (position < previous.length) {
    values = { ...defaults, ...previous[position] }
    const before = previous[position - 1]?.weight
    const todayBefore = done[position - 1]?.weight
    if (values.weight !== undefined && before !== undefined && todayBefore !== undefined) {
      values.weight = Math.max(0, values.weight + todayBefore - before)
    }
  } else {
    values = { ...defaults, ...latest }
  }

  if (preset === 'cardioTreadmill' && values.incline === undefined) values.incline = 0

  return values
}
