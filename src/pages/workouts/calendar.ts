import type { WorkoutSession } from '../../db/types'
import { addDays, weekOf, type Week, type WeekOfSessions } from '../../weeks'

// The workouts calendar: every week from the first workout's to next week, oldest first, Monday to Sunday, each
// marked by whether it met the weekly goal. A week's workouts done ahead the week before count toward it, as on the
// home page, so a week of four and a busy week of two both read as met.

// met: the goal is met. current: this week, not met yet. missed: an earlier week that fell short. next: next week.
export type WeekState = 'met' | 'current' | 'missed' | 'next'

export interface CalendarDay {
  date: string
  // The day's workouts in the order they were stored, and the one the day shows: the latest completed, or else the
  // latest started.
  workouts: Array<WorkoutSession>
  shown?: WorkoutSession
  // Whether one of the day's workouts went beyond the goal and counts toward next week. Only an extra next week needs
  // is marked: a week of four before a week of three carries nothing worth showing.
  extra: boolean
  isToday: boolean
}

export interface CalendarWeek {
  week: Week
  state: WeekState
  counted: number
  // The workouts done ahead the week before that this week needed to meet its goal.
  ahead: number
  days: Array<CalendarDay>
}

const shownOf = (workouts: Array<WorkoutSession>) =>
  workouts.filter((workout) => workout.status === 'completed').at(-1) ?? workouts.at(-1)

// weeks come newest first, as trainingWeeks gives them, with this week first.
export const calendarWeeks = (weeks: Array<WeekOfSessions>, goal: number, today: string): Array<CalendarWeek> => {
  const thisMonday = weeks[0].week.monday
  const nextMonday = addDays(thisMonday, 7)
  const needs = (of?: WeekOfSessions) => Math.max(0, goal - (of?.completed ?? 0))
  const ofWeek = (monday: string, of?: WeekOfSessions, next?: WeekOfSessions): CalendarWeek => {
    // A week's extras that the next week needs, the latest first, as trainingWeeks carries them.
    const marked = of ? of.extra.slice(Math.max(0, of.extra.length - needs(next))) : []
    const state: WeekState =
      monday === nextMonday
        ? 'next'
        : goal > 0 && (of?.counted ?? 0) >= goal
          ? 'met'
          : monday === thisMonday
            ? 'current'
            : 'missed'
    return {
      week: of?.week ?? weekOf(monday),
      state,
      counted: of?.counted ?? 0,
      ahead: Math.min(of?.ahead.length ?? 0, needs(of)),
      days: Array.from({ length: 7 }, (_, index): CalendarDay => {
        const date = addDays(monday, index)
        const workouts = (of?.sessions ?? []).filter((session) => session.date === date)
        return {
          date,
          workouts,
          shown: shownOf(workouts),
          extra: workouts.some((workout) => marked.includes(workout)),
          isToday: date === today
        }
      })
    }
  }
  return [...weeks.map((of, index) => ofWeek(of.week.monday, of, weeks[index - 1])).reverse(), ofWeek(nextMonday)]
}

// The name a program shows under its checks, where a cell is only about as wide as the check: the first word of its
// name ("Legs" for "Legs day", "Chest" for "Chest, shoulders, triceps"), unless another program starts with the same
// word, when only the whole name tells them apart. Whatever is still too long ends in an ellipsis.
export const calendarLabels = (programs: Array<{ id: string; name: string }>): Record<string, string> => {
  const firstWord = (name: string) =>
    name
      .trim()
      .split(/\s+/)[0]
      .replace(/[,:;.\-–]+$/, '') || name
  const counts = new Map<string, number>()
  for (const { name } of programs) counts.set(firstWord(name), (counts.get(firstWord(name)) ?? 0) + 1)
  return Object.fromEntries(
    programs.map(({ id, name }) => [id, counts.get(firstWord(name)) === 1 ? firstWord(name) : name])
  )
}
