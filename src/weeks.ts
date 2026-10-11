import { getSimpleDate, parseSimpleDate } from './dateUtils'
import type { ProgramRow, WorkoutSession } from './db/types'
import type { WorkoutModeSettings } from './settings'

// Training weeks, as the home page and the workouts calendar show them. A week runs Monday to Sunday and is named by
// its ISO 8601 week number, so the days around New Year belong to one week with one number: Monday 29 December 2025
// to Sunday 4 January 2026 is week 1 of 2026. Every date here is a calendar day, YYYY-MM-DD.

export interface Week {
  // The week's Monday, which also keys it.
  monday: string
  // The ISO week number, 1 to 53, and the year it counts in, which differs from the calendar year of the days that
  // fall before week 1 or after the last week.
  number: number
  year: number
}

export interface WeekOfSessions {
  week: Week
  // The week's sessions in date order.
  sessions: Array<WorkoutSession>
  completed: number
}

export interface ProgramStatus {
  program: ProgramRow
  // The program's latest workout this week.
  thisWeek?: WorkoutSession
  // The program's latest completed workout and the whole days since, which are 0 on the day itself.
  lastCompleted?: { date: string; daysAgo: number }
}

export interface TrainingWeeks {
  // How many completed workouts a week aims for: every program in rotation mode, the weekly goal in freestyle mode.
  goal: number
  // Every week from the first session's to today's, newest first, so the first is this week. A week without a
  // session is still there, and sessions dated after this week are left out.
  weeks: Array<WeekOfSessions>
  // One entry per program, in the order given.
  programs: Array<ProgramStatus>
}

export const addDays = (date: string, days: number): string => {
  const day = parseSimpleDate(date)
  return getSimpleDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days))
}

// Whole calendar days from `from` to `to`. Rounding absorbs a daylight saving hour.
const daysBetween = (from: string, to: string): number =>
  Math.round((parseSimpleDate(to).getTime() - parseSimpleDate(from).getTime()) / (24 * 60 * 60 * 1000))

export const weekOf = (date: string): Week => {
  const monday = addDays(date, -((parseSimpleDate(date).getDay() + 6) % 7))
  // ISO 8601 numbers a week in the year that holds its Thursday, and week 1 is the one with the year's first Thursday.
  const thursday = addDays(monday, 3)
  const year = parseSimpleDate(thursday).getFullYear()
  const number = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1
  return { monday, number, year }
}

const weeklyGoal = (settings: WorkoutModeSettings, programCount: number): number =>
  settings.mode === 'rotation' ? programCount : settings.weeklyGoal

export const trainingWeeks = (
  sessions: Array<WorkoutSession>,
  programs: Array<ProgramRow>,
  settings: WorkoutModeSettings,
  today = getSimpleDate(new Date())
): TrainingWeeks => {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date))
  const thisWeek = weekOf(today)

  const byMonday = new Map<string, Array<WorkoutSession>>()
  for (const session of sorted) {
    const { monday } = weekOf(session.date)
    const week = byMonday.get(monday)
    if (week) week.push(session)
    else byMonday.set(monday, [session])
  }

  const weeks: Array<WeekOfSessions> = []
  const firstMonday = sorted.length > 0 ? weekOf(sorted[0].date).monday : thisWeek.monday
  for (let monday = thisWeek.monday; monday >= firstMonday; monday = addDays(monday, -7)) {
    const weekSessions = byMonday.get(monday) ?? []
    weeks.push({
      week: weekOf(monday),
      sessions: weekSessions,
      completed: weekSessions.filter((session) => session.status === 'completed').length
    })
  }

  const lastCompleted = new Map<string, string>()
  for (const session of sorted) if (session.status === 'completed') lastCompleted.set(session.programId, session.date)
  const thisWeekSessions = weeks[0].sessions

  return {
    goal: weeklyGoal(settings, programs.length),
    weeks,
    programs: programs.map((program): ProgramStatus => {
      const date = lastCompleted.get(program.id)
      return {
        program,
        thisWeek: thisWeekSessions.filter((session) => session.programId === program.id).at(-1),
        lastCompleted: date === undefined ? undefined : { date, daysAgo: daysBetween(date, today) }
      }
    })
  }
}
