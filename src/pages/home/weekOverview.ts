import { getSimpleDate } from '../../dateUtils'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../../db/types'
import type { WorkoutModeSettings } from '../../settings'
import { volumeOf } from '../../trainingNumbers'
import { addDays, trainingWeeks, type ProgramStatus, type WeekOfSessions } from '../../weeks'

// What the home page shows: this week's days and goal, three highlights, and the programs to pick from. The weeks
// come from the week module, which the workouts calendar reads too.

export interface WeekDay {
  date: string
  isToday: boolean
  // The best status of the day's workouts, or undefined on a day without one.
  status?: SessionStatus
}

// An extra is a suggestion once the week met its goal, for a workout that counts toward next week.
export type ProgramPick = ProgramStatus & { isSuggested: boolean; isExtra: boolean }

export interface WeekOverview {
  days: Array<WeekDay>
  // This week's own completed workouts, those done ahead last week, and those beyond the goal that count toward
  // next week.
  completed: number
  ahead: number
  extra: number
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

const STATUS_RANK: Record<SessionStatus, number> = { incomplete: 1, completed: 2 }

// Weeks in a row that met the goal, counting back from last week. This week joins once it meets the goal, so the
// streak never drops before the week is over. Workouts done ahead count toward the week they were done for. The weeks
// are newest first, this week first.
const streakOf = ([thisWeek, ...earlier]: Array<WeekOfSessions>, goal: number) => {
  if (goal < 1) return 0
  const missed = earlier.findIndex((week) => week.counted < goal)
  return (thisWeek.counted >= goal ? 1 : 0) + (missed === -1 ? earlier.length : missed)
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
  const { goal, weeks, programs: statuses } = trainingWeeks(sessions, programs, settings, today)
  const [thisWeek, lastWeek] = weeks
  const sameDayLastWeek = addDays(today, -7)

  const days = Array.from({ length: 7 }, (_, index): WeekDay => {
    const date = addDays(thisWeek.week.monday, index)
    const status = thisWeek.sessions
      .filter((session) => session.date === date)
      .map((session) => session.status)
      .sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0]
    return { date, isToday: date === today, status }
  })

  const volume = {
    thisWeek: thisWeek.sessions.reduce((total, session) => total + volumeOf(session), 0),
    lastWeekSoFar: (lastWeek?.sessions ?? [])
      .filter((session) => session.date <= sameDayLastWeek)
      .reduce((total, session) => total + volumeOf(session), 0)
  }

  const records = personalRecordsOf([...sessions].sort((a, b) => a.date.localeCompare(b.date)))

  const picks = statuses.map((status): ProgramPick => ({ ...status, isSuggested: false, isExtra: false }))

  // A workout left unfinished this week comes first. Until the week meets its goal, the next is the program done
  // longest ago, never done first, and in rotation mode only among those neither started this week nor done ahead.
  // Once it meets the goal, the program done longest ago is an extra, which keeps the rotation's order.
  const oldestFirst = (a: ProgramPick, b: ProgramPick) =>
    (a.lastCompleted?.date ?? '').localeCompare(b.lastCompleted?.date ?? '')
  const unfinished = picks.filter((pick) => pick.thisWeek?.status === 'incomplete').at(-1)
  const goalMet = thisWeek.counted >= goal
  const suggested =
    unfinished ??
    (goalMet
      ? [...picks].sort(oldestFirst)[0]
      : picks.filter((pick) => settings.mode === 'freestyle' || (!pick.thisWeek && !pick.ahead)).sort(oldestFirst)[0])
  if (suggested) {
    suggested.isSuggested = true
    suggested.isExtra = !unfinished && goalMet
  }

  // The suggestion, then the programs still open this week, then the ones done or done ahead, each group in program
  // order.
  const isDone = (pick: ProgramPick) => pick.thisWeek?.status === 'completed' || (!pick.thisWeek && !!pick.ahead)
  const rank = (pick: ProgramPick) => (pick.isSuggested ? 0 : isDone(pick) ? 2 : 1)
  picks.sort((a, b) => rank(a) - rank(b))

  return {
    days,
    completed: thisWeek.completed,
    ahead: thisWeek.ahead.length,
    extra: thisWeek.extra.length,
    goal,
    streak: streakOf(weeks, goal),
    volume,
    personalRecords: {
      thisWeek: records.filter((record) => record.date >= thisWeek.week.monday),
      latest: records.at(-1)
    },
    picks
  }
}
