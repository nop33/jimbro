import { getSimpleDate, parseSimpleDate } from '../../dateUtils'
import { isRepsSet } from '../../db/exerciseLogging'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../../db/types'
import type { WorkoutModeSettings } from '../../settings'

// What the home page shows: this week's days and goal, three highlights, and the programs to pick from.
// Weeks run Monday to Sunday, like the workouts calendar.

export interface WeekDay {
  date: string
  isToday: boolean
  // The best status of the day's workouts, or undefined on a day without one.
  status?: SessionStatus
}

export interface ProgramPick {
  program: ProgramRow
  // This week's latest workout of the program.
  thisWeek?: WorkoutSession
  lastCompletedDate?: string
  isSuggested: boolean
}

export interface WeekOverview {
  days: Array<WeekDay>
  completed: number
  goal: number
  streak: number
  volume: { thisWeek: number; lastWeekSoFar: number }
  personalRecords: { thisWeek: Array<PersonalRecord>; latest?: PersonalRecord }
  picks: Array<ProgramPick>
}

export interface PersonalRecord {
  exerciseName: string
  date: string
  weight: number
  reps: number
}

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

export const startOfWeek = (date: Date): Date => addDays(date, -((date.getDay() + 6) % 7))

// Whole calendar days from `from` to `to`, both YYYY-MM-DD. Rounding absorbs a daylight saving hour.
export const daysBetween = (from: string, to: string): number =>
  Math.round((parseSimpleDate(to).getTime() - parseSimpleDate(from).getTime()) / (24 * 60 * 60 * 1000))

const STATUS_RANK: Record<SessionStatus, number> = { incomplete: 1, completed: 2 }

const volumeOf = (session: WorkoutSession) =>
  session.exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.reduce((sum, set) => (isRepsSet(set) ? sum + set.reps * (set.weight ?? 0) : sum), 0),
    0
  )

// Weeks in a row that met the goal, counting back from last week. This week joins once it meets the goal, so the
// streak never drops before the week is over.
const streakOf = (completedPerWeek: Map<string, number>, goal: number, thisMonday: Date) => {
  if (goal < 1) return 0
  let streak = (completedPerWeek.get(getSimpleDate(thisMonday)) ?? 0) >= goal ? 1 : 0
  for (let monday = addDays(thisMonday, -7); (completedPerWeek.get(getSimpleDate(monday)) ?? 0) >= goal; ) {
    streak++
    monday = addDays(monday, -7)
  }
  return streak
}

// A lifting set is a record when it beats the exercise's heaviest earlier weight, or matches it with more reps.
// An exercise's first workout sets the bar without counting as a record.
const personalRecordsOf = (sessions: Array<WorkoutSession>) => {
  const best = new Map<string, { weight: number; reps: number }>()
  const records: Array<PersonalRecord> = []
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      let top: { weight: number; reps: number } | undefined
      for (const set of exercise.sets) {
        if (set.preset !== 'lifting' || set.reps < 1) continue
        if (!top || set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps)) {
          top = { weight: set.weight, reps: set.reps }
        }
      }
      if (!top) continue
      const previous = best.get(exercise.exerciseId)
      if (!previous || top.weight > previous.weight || (top.weight === previous.weight && top.reps > previous.reps)) {
        if (previous) records.push({ exerciseName: exercise.name, date: session.date, ...top })
        best.set(exercise.exerciseId, top)
      }
    }
  }
  return records
}

export const buildWeekOverview = (
  sessions: Array<WorkoutSession>,
  programs: Array<ProgramRow>,
  settings: WorkoutModeSettings,
  now = new Date()
): WeekOverview => {
  const today = getSimpleDate(now)
  const thisMonday = startOfWeek(now)
  const monday = getSimpleDate(thisMonday)
  const sunday = getSimpleDate(addDays(thisMonday, 6))
  const lastMonday = getSimpleDate(addDays(thisMonday, -7))
  const sameDayLastWeek = getSimpleDate(addDays(now, -7))
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date))
  const thisWeek = sorted.filter((session) => session.date >= monday && session.date <= sunday)

  const days = Array.from({ length: 7 }, (_, index): WeekDay => {
    const date = getSimpleDate(addDays(thisMonday, index))
    const status = thisWeek
      .filter((session) => session.date === date)
      .map((session) => session.status)
      .sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0]
    return { date, isToday: date === today, status }
  })

  const completedPerWeek = new Map<string, number>()
  for (const session of sorted) {
    if (session.status !== 'completed') continue
    const week = getSimpleDate(startOfWeek(parseSimpleDate(session.date)))
    completedPerWeek.set(week, (completedPerWeek.get(week) ?? 0) + 1)
  }
  const goal = settings.mode === 'rotation' ? programs.length : settings.weeklyGoal
  const completed = completedPerWeek.get(monday) ?? 0

  const volume = {
    thisWeek: thisWeek.reduce((total, session) => total + volumeOf(session), 0),
    lastWeekSoFar: sorted
      .filter((session) => session.date >= lastMonday && session.date <= sameDayLastWeek)
      .reduce((total, session) => total + volumeOf(session), 0)
  }

  const records = personalRecordsOf(sorted)

  const lastCompleted = new Map<string, string>()
  for (const session of sorted) if (session.status === 'completed') lastCompleted.set(session.programId, session.date)

  const picks = programs.map(
    (program): ProgramPick => ({
      program,
      thisWeek: thisWeek.filter((session) => session.programId === program.id).at(-1),
      lastCompletedDate: lastCompleted.get(program.id),
      isSuggested: false
    })
  )

  // A workout left unfinished this week comes first. Until the week meets its goal, the next is the program done
  // longest ago, never done first, and in rotation mode only among those not started this week.
  const oldestFirst = (a: ProgramPick, b: ProgramPick) =>
    (a.lastCompletedDate ?? '').localeCompare(b.lastCompletedDate ?? '')
  const unfinished = picks.filter((pick) => pick.thisWeek?.status === 'incomplete').at(-1)
  const suggested =
    unfinished ??
    (completed >= goal
      ? undefined
      : picks.filter((pick) => settings.mode === 'freestyle' || !pick.thisWeek).sort(oldestFirst)[0])
  if (suggested) suggested.isSuggested = true

  // The suggestion, then the programs still open this week, then the ones done, each group in program order.
  const rank = (pick: ProgramPick) => (pick.isSuggested ? 0 : pick.thisWeek?.status === 'completed' ? 2 : 1)
  picks.sort((a, b) => rank(a) - rank(b))

  return {
    days,
    completed,
    goal,
    streak: streakOf(completedPerWeek, goal, thisMonday),
    volume,
    personalRecords: { thisWeek: records.filter((record) => record.date >= monday), latest: records.at(-1) },
    picks
  }
}
