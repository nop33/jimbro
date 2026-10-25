import { breakTimerEnabled } from '../../db/exerciseLogging'
import { nextUnfinished, progressOf } from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import type { Break } from '../../features/breakTimer'

// What a change to the open workout means for the lifter, which openSession acts on.
export type Outcome =
  | { kind: 'workout-done' }
  | { kind: 'exercise-done'; exerciseId: string }
  | ({ kind: 'rest' } & Break)
  | { kind: 'none' }

const NONE: Outcome = { kind: 'none' }

// Compares the workout before and after one write. Any write that takes it from incomplete to completed finishes the
// workout, whatever it was. Otherwise only a set logged for an exercise, loggedFor, means more: the exercise is done,
// or the lifter rests for breakSeconds when its preset has a break timer.
export function outcomeOf(
  before: WorkoutSession,
  after: WorkoutSession,
  loggedFor: string | undefined,
  breakSeconds: number
): Outcome {
  if (after.status === 'completed') return before.status === 'incomplete' ? { kind: 'workout-done' } : NONE
  if (loggedFor === undefined) return NONE

  const exercise = after.exercises.find(({ exerciseId }) => exerciseId === loggedFor)
  const earlier = before.exercises.find(({ exerciseId }) => exerciseId === loggedFor)
  if (!exercise || exercise.sets.length <= (earlier?.sets.length ?? 0)) return NONE

  const progress = progressOf(exercise)
  if (progress.done) return { kind: 'exercise-done', exerciseId: loggedFor }
  if (!breakTimerEnabled(exercise.preset)) return NONE
  return {
    kind: 'rest',
    seconds: breakSeconds,
    setsDone: progress.logged,
    setsTotal: progress.target,
    next: nextUnfinished(after, loggedFor)?.name,
    exercise: { id: loggedFor, name: exercise.name, kind: exercise.kind }
  }
}
