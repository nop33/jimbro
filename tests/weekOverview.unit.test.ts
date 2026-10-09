import { describe, expect, it } from 'vite-plus/test'
import type { ExerciseSetExecution } from '../src/db/exerciseLogging'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../src/db/types'
import { buildWeekOverview } from '../src/pages/home/weekOverview'

// Friday 9 October 2026. The week runs from Monday the 5th to Sunday the 11th.
const NOW = new Date(2026, 9, 9, 7, 30)
const ROTATION = { mode: 'rotation', weeklyGoal: 3 } as const

const program = (id: string): ProgramRow => ({ id, name: id, exercises: [], isDeleted: false, updatedAt: '' })
const PROGRAMS = [program('push'), program('pull'), program('legs')]

const lift = (reps: number, weight: number): ExerciseSetExecution => ({ preset: 'lifting', reps, weight })

const session = (
  date: string,
  programId: string,
  status: SessionStatus = 'completed',
  sets: Array<ExerciseSetExecution> = []
): WorkoutSession => ({
  id: `${programId}-${date}`,
  date,
  programId,
  location: '',
  status,
  updatedAt: '',
  exercises: [
    {
      exerciseId: 'bench',
      name: 'Bench press',
      kind: 'lifting',
      preset: 'lifting',
      targetSets: 3,
      defaults: {},
      sets
    }
  ]
})

describe('buildWeekOverview', () => {
  it('lays out Monday to Sunday with each day’s workout and today', () => {
    const { days, completed, goal } = buildWeekOverview(
      [session('2026-10-06', 'push'), session('2026-10-07', 'pull'), session('2026-10-09', 'legs', 'incomplete')],
      PROGRAMS,
      ROTATION,
      NOW
    )

    expect(days.map((day) => day.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11'
    ])
    expect(days.map((day) => day.status)).toEqual([
      undefined,
      'completed',
      'completed',
      undefined,
      'incomplete',
      undefined,
      undefined
    ])
    expect(days.findIndex((day) => day.isToday)).toBe(4)
    expect({ completed, goal }).toEqual({ completed: 2, goal: 3 })
  })

  it('suggests the program not done this week that was done longest ago, then the open ones, then the done ones', () => {
    const { picks } = buildWeekOverview(
      [session('2026-09-20', 'legs'), session('2026-09-28', 'pull'), session('2026-10-06', 'push')],
      PROGRAMS,
      ROTATION,
      NOW
    )

    expect(picks.map((pick) => [pick.program.id, pick.isSuggested])).toEqual([
      ['legs', true],
      ['pull', false],
      ['push', false]
    ])
    expect(picks[0].lastCompletedDate).toBe('2026-09-20')
  })

  it('suggests a program never done before any other', () => {
    const { picks } = buildWeekOverview([session('2026-09-20', 'legs')], PROGRAMS, ROTATION, NOW)
    expect(picks.find((pick) => pick.isSuggested)?.program.id).toBe('push')
  })

  it('suggests finishing a workout started this week', () => {
    const { picks } = buildWeekOverview([session('2026-10-08', 'pull', 'incomplete')], PROGRAMS, ROTATION, NOW)
    expect(picks[0]).toMatchObject({ program: { id: 'pull' }, isSuggested: true, thisWeek: { status: 'incomplete' } })
  })

  it('suggests nothing once the week meets its goal', () => {
    const week = [session('2026-10-05', 'push'), session('2026-10-06', 'pull'), session('2026-10-07', 'legs')]
    expect(buildWeekOverview(week, PROGRAMS, ROTATION, NOW).picks.some((pick) => pick.isSuggested)).toBe(false)
  })

  it('in freestyle mode suggests the program done longest ago, even one done this week', () => {
    const { picks, goal } = buildWeekOverview(
      [session('2026-10-05', 'legs'), session('2026-10-06', 'push'), session('2026-10-07', 'pull')],
      PROGRAMS,
      { mode: 'freestyle', weeklyGoal: 4 },
      NOW
    )
    expect(goal).toBe(4)
    expect(picks.find((pick) => pick.isSuggested)?.program.id).toBe('legs')
  })

  it('counts the weeks in a row that met the goal, and this week once it meets it', () => {
    const fullWeek = (monday: number) => [
      session(`2026-09-${String(monday).padStart(2, '0')}`, 'push'),
      session(`2026-09-${String(monday + 1).padStart(2, '0')}`, 'pull'),
      session(`2026-09-${String(monday + 2).padStart(2, '0')}`, 'legs')
    ]
    // Full weeks from 7, 14 and 28 September, and a missed week from the 21st.
    const history = [...fullWeek(7), ...fullWeek(14), session('2026-09-22', 'push'), ...fullWeek(28)]

    expect(buildWeekOverview(history, PROGRAMS, ROTATION, NOW).streak).toBe(1)

    const thisWeek = [session('2026-10-05', 'push'), session('2026-10-06', 'pull'), session('2026-10-07', 'legs')]
    expect(buildWeekOverview([...history, ...thisWeek], PROGRAMS, ROTATION, NOW).streak).toBe(2)
    expect(buildWeekOverview(thisWeek.slice(0, 2), PROGRAMS, ROTATION, NOW).streak).toBe(0)
  })

  it('compares this week’s volume with last week up to the same weekday', () => {
    const { volume } = buildWeekOverview(
      [
        session('2026-09-28', 'push', 'completed', [lift(10, 50)]),
        session('2026-10-02', 'pull', 'completed', [lift(10, 40)]),
        // Saturday last week is later in the week than today, so it stays out.
        session('2026-10-03', 'legs', 'completed', [lift(10, 100)]),
        session('2026-10-06', 'push', 'completed', [lift(10, 60), lift(8, 60)]),
        session('2026-10-09', 'pull', 'incomplete', [lift(5, 40), { preset: 'rehabHold', durationSec: 30 }])
      ],
      PROGRAMS,
      ROTATION,
      NOW
    )
    expect(volume).toEqual({ thisWeek: 600 + 480 + 200, lastWeekSoFar: 500 + 400 })
  })

  it('finds the sets that beat an exercise’s heaviest earlier weight, or matched it with more reps', () => {
    const { personalRecords } = buildWeekOverview(
      [
        session('2026-09-21', 'push', 'completed', [lift(8, 70)]),
        session('2026-09-28', 'push', 'completed', [lift(8, 75)]),
        session('2026-10-06', 'push', 'completed', [lift(10, 75), lift(5, 72.5)])
      ],
      PROGRAMS,
      ROTATION,
      NOW
    )
    expect(personalRecords.thisWeek).toEqual([
      { exerciseName: 'Bench press', date: '2026-10-06', weight: 75, reps: 10 }
    ])
    expect(personalRecords.latest?.date).toBe('2026-10-06')
  })

  it('does not count an exercise’s first workout as a record', () => {
    const { personalRecords } = buildWeekOverview(
      [session('2026-10-06', 'push', 'completed', [lift(8, 70)])],
      PROGRAMS,
      ROTATION,
      NOW
    )
    expect(personalRecords).toEqual({ thisWeek: [], latest: undefined })
  })
})
