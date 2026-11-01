import { describe, expect, it } from 'vite-plus/test'
import type { ExerciseSetExecution } from '../src/db/exerciseLogging'
import type { SessionStatus, WorkoutSession } from '../src/db/types'
import { trainingTotals } from '../src/trainingNumbers'

// Friday 9 October 2026. Its week runs from Monday the 5th.
const TODAY = '2026-10-09'

const lift = (reps: number, weight: number): ExerciseSetExecution => ({ preset: 'lifting', reps, weight })

const session = (
  date: string,
  status: SessionStatus,
  sets: Array<ExerciseSetExecution>,
  otherSets: Array<ExerciseSetExecution> = []
): WorkoutSession => ({
  id: date,
  date,
  programId: 'program',
  location: '',
  status,
  updatedAt: '',
  exercises: [
    { exerciseId: 'bench', name: 'Bench', kind: 'lifting', preset: 'lifting', targetSets: 2, defaults: {}, sets },
    { exerciseId: 'row', name: 'Row', kind: 'lifting', preset: 'lifting', targetSets: 2, defaults: {}, sets: otherSets }
  ]
})

describe('trainingTotals', () => {
  it('counts every logged set toward volume, sets and reps, and only completed workouts as workouts', () => {
    const totals = trainingTotals(
      [
        session('2026-10-06', 'completed', [lift(5, 60), lift(8, 50)], [lift(10, 40), lift(10, 40)]),
        session('2026-10-08', 'incomplete', [lift(10, 100)])
      ],
      TODAY
    )

    expect(totals).toMatchObject({ completed: 1, incomplete: 1, exercises: 3, sets: 5, reps: 43, daysActive: 2 })
    // 5 × 60 + 8 × 50 + 2 × 10 × 40 + 10 × 100
    expect(totals.volume).toBe(2500)
    expect(totals.firstDay).toBe('2026-10-06')
  })

  it('leaves out a day with no set logged', () => {
    const totals = trainingTotals(
      [session('2026-10-01', 'incomplete', []), session('2026-10-06', 'completed', [lift(5, 60)])],
      TODAY
    )

    expect(totals.daysActive).toBe(1)
    expect(totals.firstDay).toBe('2026-10-06')
    expect(totals.exercises).toBe(1)
  })

  it('averages completed workouts over the calendar weeks from the first one through this week', () => {
    // Weeks of 21 September, 28 September and 5 October: three weeks, the empty one and this one included.
    const sessions = [
      session('2026-09-23', 'completed', [lift(5, 60)]),
      session('2026-09-25', 'completed', [lift(5, 60)]),
      session('2026-10-06', 'completed', [lift(5, 60)]),
      session('2026-10-08', 'incomplete', [lift(5, 60)])
    ]

    expect(trainingTotals(sessions, TODAY).workoutsPerWeek).toBe(1)
  })

  it('counts a single workout as one this week, not seven', () => {
    expect(trainingTotals([session('2026-10-06', 'completed', [lift(5, 60)])], TODAY).workoutsPerWeek).toBe(1)
  })

  it('shows nothing before the first set', () => {
    expect(trainingTotals([], TODAY)).toMatchObject({ completed: 0, volume: 0, daysActive: 0, workoutsPerWeek: 0 })
    expect(trainingTotals([], TODAY).firstDay).toBeUndefined()
  })
})
