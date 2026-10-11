import { describe, expect, it } from 'vite-plus/test'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../src/db/types'
import { addDays, trainingWeeks, weekOf } from '../src/weeks'

const ROTATION = { mode: 'rotation', weeklyGoal: 3 } as const
const FREESTYLE = { mode: 'freestyle', weeklyGoal: 2 } as const

const program = (id: string): ProgramRow => ({ id, name: id, exercises: [], isDeleted: false, updatedAt: '' })
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

const withTimezone = <T>(timezone: string, callback: () => T): T => {
  const original = process.env.TZ
  process.env.TZ = timezone
  try {
    return callback()
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
}

describe('weekOf', () => {
  it('starts the week on Monday and numbers it as ISO 8601 does', () => {
    expect(weekOf('2026-10-11')).toEqual({ monday: '2026-10-05', number: 41, year: 2026 })
    expect(weekOf('2024-01-01')).toEqual({ monday: '2024-01-01', number: 1, year: 2024 })
    expect(weekOf('2024-02-29')).toEqual({ monday: '2024-02-26', number: 9, year: 2024 })
    expect(weekOf('2024-06-15')).toEqual({ monday: '2024-06-10', number: 24, year: 2024 })
  })

  it('keeps the days around a New Year that starts on a Sunday in one week', () => {
    for (const date of ['2022-12-26', '2022-12-31', '2023-01-01']) {
      expect(weekOf(date)).toEqual({ monday: '2022-12-26', number: 52, year: 2022 })
    }
    expect(weekOf('2023-01-02')).toEqual({ monday: '2023-01-02', number: 1, year: 2023 })
    expect(weekOf('2034-01-01')).toEqual({ monday: '2033-12-26', number: 52, year: 2033 })
  })

  it('counts late December in the next year when that week holds its first Thursday', () => {
    expect(weekOf('2025-12-29')).toEqual({ monday: '2025-12-29', number: 1, year: 2026 })
    expect(weekOf('2026-01-04')).toEqual({ monday: '2025-12-29', number: 1, year: 2026 })
  })

  it('counts early January in the last year when the week holds its last Thursday, week 53 included', () => {
    expect(weekOf('2020-12-31')).toEqual({ monday: '2020-12-28', number: 53, year: 2020 })
    expect(weekOf('2021-01-03')).toEqual({ monday: '2020-12-28', number: 53, year: 2020 })
    expect(weekOf('2021-01-04')).toEqual({ monday: '2021-01-04', number: 1, year: 2021 })
  })

  it('gives every day of a week the same week, and the next week the next number, from 2019 to 2035', () => {
    let previous = weekOf('2018-12-31')
    for (let monday = '2019-01-07'; monday < '2036-01-01'; monday = addDays(monday, 7)) {
      const week = weekOf(monday)
      for (let day = 1; day < 7; day++) expect(weekOf(addDays(monday, day))).toEqual(week)
      expect(week.monday).toBe(monday)
      expect(
        week.year === previous.year ? week.number === previous.number + 1 : week.number === 1 && previous.number >= 52
      ).toBe(true)
      previous = week
    }
  })

  it('finds the same week across a daylight saving change', () => {
    for (const timezone of ['Europe/London', 'America/New_York', 'Australia/Sydney']) {
      withTimezone(timezone, () => {
        expect(weekOf('2026-05-25')).toEqual({ monday: '2026-05-25', number: 22, year: 2026 })
        expect(weekOf('2026-11-01')).toEqual({ monday: '2026-10-26', number: 44, year: 2026 })
        expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
      })
    }
  })
})

describe('trainingWeeks', () => {
  it('lists every week from the first session to today, newest first, across a New Year', () => {
    const { weeks } = trainingWeeks(
      [session('2023-01-03', 'pull'), session('2022-12-20', 'push'), session('2023-01-01', 'legs', 'incomplete')],
      PROGRAMS,
      ROTATION,
      '2023-01-10'
    )

    expect(weeks.map(({ week }) => [week.monday, week.number, week.year])).toEqual([
      ['2023-01-09', 2, 2023],
      ['2023-01-02', 1, 2023],
      ['2022-12-26', 52, 2022],
      ['2022-12-19', 51, 2022]
    ])
    expect(weeks.map(({ sessions }) => sessions.map((one) => one.date))).toEqual([
      [],
      ['2023-01-03'],
      ['2023-01-01'],
      ['2022-12-20']
    ])
    expect(weeks.map(({ completed }) => completed)).toEqual([0, 1, 0, 1])
  })

  it('puts a week’s sessions in date order and leaves out sessions after this week', () => {
    const { weeks } = trainingWeeks(
      [session('2026-10-09', 'legs'), session('2026-10-06', 'push'), session('2026-10-13', 'pull')],
      PROGRAMS,
      ROTATION,
      '2026-10-07'
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0].sessions.map((one) => one.date)).toEqual(['2026-10-06', '2026-10-09'])
  })

  it('has only this week without sessions', () => {
    const { weeks } = trainingWeeks([], PROGRAMS, ROTATION, '2026-10-11')
    expect(weeks).toEqual([{ week: weekOf('2026-10-11'), sessions: [], completed: 0 }])
  })

  it('aims for every program in rotation mode and for the weekly goal in freestyle mode', () => {
    expect(trainingWeeks([], PROGRAMS, ROTATION, '2026-10-11').goal).toBe(3)
    expect(trainingWeeks([], PROGRAMS, FREESTYLE, '2026-10-11').goal).toBe(2)
  })

  it('gives each program its latest workout this week and its latest completed one', () => {
    const { programs } = trainingWeeks(
      [
        session('2026-09-20', 'legs'),
        session('2026-10-01', 'push'),
        session('2026-10-05', 'push', 'incomplete'),
        session('2026-10-06', 'pull', 'incomplete'),
        session('2026-10-07', 'pull')
      ],
      PROGRAMS,
      ROTATION,
      '2026-10-08'
    )

    expect(
      programs.map(({ program, thisWeek, lastCompleted }) => [
        program.id,
        thisWeek?.date,
        thisWeek?.status,
        lastCompleted
      ])
    ).toEqual([
      ['push', '2026-10-05', 'incomplete', { date: '2026-10-01', daysAgo: 7 }],
      ['pull', '2026-10-07', 'completed', { date: '2026-10-07', daysAgo: 1 }],
      ['legs', undefined, undefined, { date: '2026-09-20', daysAgo: 18 }]
    ])
  })

  it('leaves out the last completed date of a program never completed', () => {
    const { programs } = trainingWeeks([session('2026-10-06', 'push', 'incomplete')], PROGRAMS, ROTATION, '2026-10-08')
    expect(programs[0].lastCompleted).toBeUndefined()
  })

  it('counts whole calendar days since the last completed workout across a daylight saving change', () => {
    withTimezone('Europe/London', () => {
      const { programs } = trainingWeeks([session('2026-03-28', 'push')], PROGRAMS, ROTATION, '2026-03-30')
      expect(programs[0].lastCompleted).toEqual({ date: '2026-03-28', daysAgo: 2 })
    })
  })
})
