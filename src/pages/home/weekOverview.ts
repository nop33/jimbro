import { getSimpleDate } from '../../dateUtils'
import { isRepsSet } from '../../db/exerciseLogging'
import type { ProgramRow, SessionStatus, WorkoutSession } from '../../db/types'
import type { WorkoutModeSettings } from '../../settings'
import { addDays, trainingWeeks, type ProgramStatus, type WeekOfSessions } from '../../weeks'

// What the home page shows: this week's days and goal, three highlights, and the programs to pick from. The weeks
// come from the week module, which the workouts calendar reads too.

export interface WeekDay {
  date: string
  isToday: boolean
  // The best status of the day's workouts, or undefined on a day without one.
  status?: SessionStatus
}

export type ProgramPick = ProgramStatus & { isSuggested: boolean }

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

const STATUS_RANK: Record<SessionStatus, number> = { incomplete: 1, completed: 2 }

const volumeOf = (session: WorkoutSession) =>
  session.exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.reduce((sum, set) => (isRepsSet(set) ? sum + set.reps * (set.weight ?? 0) : sum), 0),
    0
  )

// Weeks in a row that met the goal, counting back from last week. This week joins once it meets the goal, so the
// streak never drops before the week is over. The weeks are newest first, this week first.
const streakOf = ([thisWeek, ...earlier]: Array<WeekOfSessions>, goal: number) => {
  if (goal < 1) return 0
  const missed = earlier.findIndex((week) => week.completed < goal)
  return (thisWeek.completed >= goal ? 1 : 0) + (missed === -1 ? earlier.length : missed)
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

  const picks = statuses.map((status): ProgramPick => ({ ...status, isSuggested: false }))

  // A workout left unfinished this week comes first. Until the week meets its goal, the next is the program done
  // longest ago, never done first, and in rotation mode only among those not started this week.
  const oldestFirst = (a: ProgramPick, b: ProgramPick) =>
    (a.lastCompleted?.date ?? '').localeCompare(b.lastCompleted?.date ?? '')
  const unfinished = picks.filter((pick) => pick.thisWeek?.status === 'incomplete').at(-1)
  const suggested =
    unfinished ??
    (thisWeek.completed >= goal
      ? undefined
      : picks.filter((pick) => settings.mode === 'freestyle' || !pick.thisWeek).sort(oldestFirst)[0])
  if (suggested) suggested.isSuggested = true

  // The suggestion, then the programs still open this week, then the ones done, each group in program order.
  const rank = (pick: ProgramPick) => (pick.isSuggested ? 0 : pick.thisWeek?.status === 'completed' ? 2 : 1)
  picks.sort((a, b) => rank(a) - rank(b))

  return {
    days,
    completed: thisWeek.completed,
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
