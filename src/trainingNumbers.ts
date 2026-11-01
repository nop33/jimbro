import { isRepsSet } from './db/exerciseLogging'
import type { WorkoutSession } from './db/types'
import { addDays, weekOf } from './weeks'

// The training numbers the home page and the stats page show, counted one way. Every set logged counts toward volume,
// sets and reps, in a finished workout or not. A workout counts as one only once completed, as the streak counts it.

// Weight times reps over a workout's sets with reps.
export const volumeOf = (session: WorkoutSession): number =>
  session.exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.reduce((sum, set) => (isRepsSet(set) ? sum + set.reps * (set.weight ?? 0) : sum), 0),
    0
  )

export interface TrainingTotals {
  completed: number
  incomplete: number
  volume: number
  // Exercises with a set logged, once per workout.
  exercises: number
  sets: number
  reps: number
  // The days with a set logged, and the first of them.
  daysActive: number
  firstDay?: string
  // Completed workouts over the calendar weeks, Monday to Sunday, from the first day's week through this week.
  workoutsPerWeek: number
}

export const trainingTotals = (sessions: Array<WorkoutSession>, today: string): TrainingTotals => {
  const totals: TrainingTotals = {
    completed: 0,
    incomplete: 0,
    volume: 0,
    exercises: 0,
    sets: 0,
    reps: 0,
    daysActive: 0,
    workoutsPerWeek: 0
  }
  const days = new Set<string>()

  for (const session of sessions) {
    if (session.status === 'completed') totals.completed++
    else totals.incomplete++
    totals.volume += volumeOf(session)
    for (const exercise of session.exercises) {
      if (exercise.sets.length === 0) continue
      totals.exercises++
      totals.sets += exercise.sets.length
      for (const set of exercise.sets) if (isRepsSet(set)) totals.reps += set.reps
      days.add(session.date)
    }
  }

  totals.daysActive = days.size
  totals.firstDay = [...days].sort()[0]
  if (totals.firstDay !== undefined) {
    let weeks = 0
    const thisMonday = weekOf(today).monday
    for (let monday = weekOf(totals.firstDay).monday; monday <= thisMonday; monday = addDays(monday, 7)) weeks++
    totals.workoutsPerWeek = totals.completed / Math.max(weeks, 1)
  }
  return totals
}
