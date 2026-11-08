import { describe, expect, it } from 'vite-plus/test'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../src/db/types'
import { calendarLabels, calendarWeeks } from '../src/pages/workouts/calendar'
import type { WorkoutModeSettings } from '../src/settings'
import { trainingWeeks } from '../src/weeks'

const ROTATION: WorkoutModeSettings = { mode: 'rotation', weeklyGoal: 3 }
const program = (id: string, name = id): ProgramRow => ({ id, name, exercises: [], isDeleted: false, updatedAt: '' })
const PROGRAMS = [program('push'), program('pull'), program('legs')]

const session = (date: string, programId: string, status: SessionStatus = 'completed'): WorkoutSession => ({
  id: `${programId}-${date}`,
  date,
  programId,
  location: '',
  status,
  updatedAt: '',
  exercises: []
})

const calendar = (sessions: Array<WorkoutSession>, today: string, settings = ROTATION) => {
  const { goal, weeks } = trainingWeeks(sessions, PROGRAMS, settings, today)
  return calendarWeeks(weeks, goal, today)
}
const oldestFirst = (...args: Parameters<typeof calendar>) => [...calendar(...args)].reverse()

describe('calendarWeeks', () => {
  it('lists the weeks newest first, from next week to the first workout, Monday to Sunday', () => {
    const weeks = calendar([session('2026-10-28', 'push')], '2026-11-10')
    expect(weeks.map(({ week, state }) => [week.monday, state])).toEqual([
      ['2026-11-16', 'next'],
      ['2026-11-09', 'current'],
      ['2026-11-02', 'missed'],
      ['2026-10-26', 'partial']
    ])
    expect(weeks[3].days.map((day) => day.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01'
    ])
    expect(weeks[3].days[2].shown?.id).toBe('push-2026-10-28')
    expect(weeks[1].days.find((day) => day.isToday)?.date).toBe('2026-11-10')
  })

  it("names the month on each month's first week, by the month its Thursday is in", () => {
    const weeks = calendar([session('2026-10-20', 'push')], '2026-11-10')
    // The week of 27 October ends on 2 November, but its Thursday is in October.
    expect(weeks.map(({ week, month }) => [week.monday, month])).toEqual([
      ['2026-11-16', '2026-11-01'],
      ['2026-11-09', undefined],
      ['2026-11-02', undefined],
      ['2026-10-26', '2026-10-01'],
      ['2026-10-19', undefined]
    ])
  })

  it('marks a week met once its workouts and those done ahead reach the goal', () => {
    const weeks = oldestFirst(
      [
        session('2026-11-02', 'legs'),
        session('2026-11-04', 'push'),
        session('2026-11-06', 'pull'),
        session('2026-11-08', 'legs'),
        session('2026-11-11', 'push'),
        session('2026-11-13', 'pull')
      ],
      '2026-11-15'
    )
    const [aheadWeek, busyWeek] = weeks
    expect(aheadWeek).toMatchObject({ state: 'met', ahead: 0 })
    expect(aheadWeek.days.map((day) => day.extra)).toEqual([false, false, false, false, false, false, true])
    expect(busyWeek).toMatchObject({ state: 'met', ahead: 1, counted: 3 })
  })

  it('marks an extra only when the next week needs it', () => {
    const fullWeeks = [
      ...['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08'].map((date) => session(date, 'push')),
      ...['2026-11-10', '2026-11-11', '2026-11-12'].map((date) => session(date, 'pull'))
    ]
    const [aheadWeek, fullWeek] = oldestFirst(fullWeeks, '2026-11-15')
    expect(aheadWeek.days.some((day) => day.extra)).toBe(false)
    expect(fullWeek.ahead).toBe(0)
  })

  it('marks this week’s extras, which next week has yet to use', () => {
    const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((date) => session(date, 'legs'))
    const [thisWeek] = oldestFirst(week, '2026-11-12')
    expect(thisWeek.state).toBe('met')
    expect(thisWeek.days.filter((day) => day.extra).map((day) => day.date)).toEqual(['2026-11-12'])
  })

  it('shows the latest completed workout of a day, or else the latest started one', () => {
    const [week] = oldestFirst(
      [
        session('2026-11-10', 'push'),
        session('2026-11-10', 'legs', 'incomplete'),
        session('2026-11-11', 'pull', 'incomplete')
      ],
      '2026-11-12'
    )
    expect(week.days[1].workouts).toHaveLength(2)
    expect(week.days[1].shown?.programId).toBe('push')
    expect(week.days[2].shown?.status).toBe('incomplete')
  })

  it('goes by the weekly goal in freestyle mode', () => {
    const [week] = oldestFirst([session('2026-11-10', 'push'), session('2026-11-11', 'push')], '2026-11-12', {
      mode: 'freestyle',
      weeklyGoal: 2
    })
    expect(week.state).toBe('met')
  })
})

describe('calendarLabels', () => {
  it('labels each program with the first word of its name', () => {
    expect(
      calendarLabels([
        program('a', 'Chest, shoulders, triceps'),
        program('b', 'Pull day: back and biceps'),
        program('c', 'Legs day'),
        program('d', 'Cardio')
      ])
    ).toEqual({ a: 'Chest', b: 'Pull', c: 'Legs', d: 'Cardio' })
  })

  it('keeps the whole name when two programs start with the same word', () => {
    expect(calendarLabels([program('a', 'Legs A'), program('b', 'Legs B'), program('c', 'Push')])).toEqual({
      a: 'Legs A',
      b: 'Legs B',
      c: 'Push'
    })
  })
})
