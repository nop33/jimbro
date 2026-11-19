import type { WorkoutSession } from './db/types'
import { volumeOf } from './trainingNumbers'
import { addDays, weekOf } from './weeks'

// The stats page's activity map: the last twelve months as weeks, Monday to Sunday, each day with the sets and the
// volume logged on it, as trainingTotals counts them, in a finished workout or not. The app keeps no workout's start
// or end time, so sets stand in for time spent training, and they count cardio and bodyweight days too.

export const ACTIVITY_METRICS = ['sets', 'volume'] as const
export type ActivityMetric = (typeof ACTIVITY_METRICS)[number]

export interface ActivityDay {
  date: string
  sets: number
  volume: number
  // After today, in this week: drawn as a gap.
  future: boolean
}

export interface ActivityWeek {
  monday: string
  // The 1st of the month when this week holds it, to label the column.
  monthStart?: string
  days: Array<ActivityDay>
}

// Fifty-two whole weeks before this one, and this one: a year and a few days.
export const ACTIVITY_WEEKS = 53

export const activityWeeks = (sessions: Array<WorkoutSession>, today: string): Array<ActivityWeek> => {
  const byDate = new Map<string, { sets: number; volume: number }>()
  for (const session of sessions) {
    const sets = session.exercises.reduce((total, exercise) => total + exercise.sets.length, 0)
    if (sets === 0) continue
    const day = byDate.get(session.date) ?? { sets: 0, volume: 0 }
    day.sets += sets
    day.volume += volumeOf(session)
    byDate.set(session.date, day)
  }

  const weeks: Array<ActivityWeek> = []
  let monday = addDays(weekOf(today).monday, -7 * (ACTIVITY_WEEKS - 1))
  for (let week = 0; week < ACTIVITY_WEEKS; week++, monday = addDays(monday, 7)) {
    const days: Array<ActivityDay> = []
    let monthStart: string | undefined
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(monday, offset)
      if (date.endsWith('-01')) monthStart = date
      days.push({ date, sets: 0, volume: 0, ...byDate.get(date), future: date > today })
    }
    weeks.push({ monday, monthStart, days })
  }
  return weeks
}

// A level from 0, nothing logged, to 4, the year's biggest day: each quarter of the biggest day's value is a level, so a
// lifter who trains the same amount each time sees full squares, not a spread made up from small differences.
export type ActivityLevel = 0 | 1 | 2 | 3 | 4

export const activityLevels = (values: Array<number>): ((value: number) => ActivityLevel) => {
  const most = Math.max(0, ...values)
  return (value) => (value <= 0 || most === 0 ? 0 : (Math.max(1, Math.ceil((4 * value) / most)) as ActivityLevel))
}
