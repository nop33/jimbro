import { describe, expect, it } from 'vite-plus/test'
import { ACTIVITY_WEEKS, activityLevels, activityWeeks } from '../src/activityMap'
import type { ExerciseSetExecution } from '../src/db/exerciseLogging'
import type { WorkoutSession } from '../src/db/types'

// Thursday 19 November 2026. Its week runs from Monday the 16th.
const TODAY = '2026-11-19'

const lift = (reps: number, weight: number): ExerciseSetExecution => ({ preset: 'lifting', reps, weight })

const session = (date: string, sets: Array<ExerciseSetExecution>): WorkoutSession => ({
  id: date,
  date,
  programId: 'program',
  location: '',
  status: 'incomplete',
  updatedAt: '',
  exercises: [
    { exerciseId: 'bench', name: 'Bench', kind: 'lifting', preset: 'lifting', targetSets: 2, defaults: {}, sets }
  ]
})

describe('activityWeeks', () => {
  it('lays out a year of weeks, Monday first, ending with this one', () => {
    const weeks = activityWeeks([], TODAY)

    expect(weeks).toHaveLength(ACTIVITY_WEEKS)
    expect(weeks.at(-1)?.monday).toBe('2026-11-16')
    expect(weeks[0].monday).toBe('2025-11-17')
    expect(weeks.every((week) => week.days.length === 7)).toBe(true)
    expect(weeks.at(-1)?.days.map((day) => day.future)).toEqual([false, false, false, false, true, true, true])
  })

  it('labels the week that holds the 1st of a month', () => {
    const weeks = activityWeeks([], TODAY)

    // Sunday 1 November 2026 ends the week of Monday 26 October.
    expect(weeks.find((week) => week.monday === '2026-10-26')?.monthStart).toBe('2026-11-01')
    expect(weeks.find((week) => week.monday === '2026-11-02')?.monthStart).toBeUndefined()
    expect(weeks.filter((week) => week.monthStart !== undefined)).toHaveLength(12)
  })

  it('adds up the sets and the volume of each day, and leaves out what is older than the year', () => {
    const weeks = activityWeeks(
      [
        session('2026-11-17', [lift(5, 60), lift(8, 50)]),
        session('2026-11-17', [lift(10, 20)]),
        session('2026-11-18', []),
        session('2024-01-01', [lift(5, 60)])
      ],
      TODAY
    )
    const days = weeks.flatMap((week) => week.days)

    expect(days.find((day) => day.date === '2026-11-17')).toMatchObject({ sets: 3, volume: 900 })
    expect(days.find((day) => day.date === '2026-11-18')).toMatchObject({ sets: 0, volume: 0 })
    expect(days.reduce((sum, day) => sum + day.sets, 0)).toBe(3)
  })
})

describe('activityLevels', () => {
  it('shades by quarters of the biggest day, with nothing logged at 0', () => {
    const levelOf = activityLevels([0, 1, 10, 20, 40])

    expect([0, 1, 10, 11, 20, 30, 40].map(levelOf)).toEqual([0, 1, 1, 2, 2, 3, 4])
  })

  it('shades every day the same when every day is the same', () => {
    const levelOf = activityLevels([18, 18, 0])

    expect(levelOf(18)).toBe(4)
  })

  it('leaves everything empty with nothing logged', () => {
    expect(activityLevels([0, 0])(0)).toBe(0)
  })
})
