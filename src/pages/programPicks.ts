import { parseSimpleDate } from '../dateUtils'
import type { WorkoutModeSettings } from '../settings'
import { nodeFromTemplate, setTextContent } from '../utils'
import type { ProgramStatus } from '../weeks'

// The list of programs to pick a workout from, which Home shows under "Pick your workout" and the Workouts page in its
// New sheet. Each page holds the list's `<ul>` and the `program-pick` partial's template.

// An extra is a suggestion once the week met its goal, for a workout that counts toward next week.
export type ProgramPick = ProgramStatus & { isSuggested: boolean; isExtra: boolean }

// The programs in the order to offer them, the next one to do marked. `counted` is the week's workouts toward its
// goal, done ahead ones included.
export const pickPrograms = (
  statuses: Array<ProgramStatus>,
  counted: number,
  goal: number,
  settings: WorkoutModeSettings
): Array<ProgramPick> => {
  const picks = statuses.map((status): ProgramPick => ({ ...status, isSuggested: false, isExtra: false }))

  // A workout left unfinished this week comes first. Until the week meets its goal, the next is the program done
  // longest ago, never done first, and in rotation mode only among those neither started this week nor done ahead.
  // Once it meets the goal, the program done longest ago is an extra, which keeps the rotation's order.
  const oldestFirst = (a: ProgramPick, b: ProgramPick) =>
    (a.lastCompleted?.date ?? '').localeCompare(b.lastCompleted?.date ?? '')
  const unfinished = picks.filter((pick) => pick.thisWeek?.status === 'incomplete').at(-1)
  const goalMet = counted >= goal
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
  return picks.sort((a, b) => rank(a) - rank(b))
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const formatDay = (date: string) => dayFormat.format(parseSimpleDate(date))

const lastDoneText = (lastCompleted: ProgramPick['lastCompleted']) => {
  if (!lastCompleted) return 'Not done yet'
  const days = lastCompleted.daysAgo
  if (days === 0) return 'Last done today'
  if (days === 1) return 'Last done yesterday'
  return `Last done ${days} days ago`
}

const pickMeta = ({ thisWeek, ahead, lastCompleted }: ProgramPick) => {
  if (thisWeek?.status === 'completed') return `Done ${formatDay(thisWeek.date)}`
  if (ahead) return `Done ahead ${formatDay(ahead.date)}`
  if (thisWeek?.status === 'incomplete') return `Started ${formatDay(thisWeek.date)}`
  return lastDoneText(lastCompleted)
}

// One row per pick: a workout started this week continues it, any other starts a new one of the program.
export const renderProgramPicks = (list: HTMLUListElement, picks: Array<ProgramPick>) => {
  for (const pick of picks) {
    const item = nodeFromTemplate('#program-pick-template')
    const link = item.querySelector('a') as HTMLAnchorElement
    const status = pick.thisWeek?.status ?? (pick.ahead ? 'completed' : undefined)
    link.href = status === 'incomplete' ? `/gymtime/?id=${pick.thisWeek?.id}` : `/gymtime/?programId=${pick.program.id}`
    if (status) link.dataset.status = status
    if (pick.isSuggested) link.dataset.suggested = ''
    if (pick.isExtra) link.dataset.extra = ''
    setTextContent('.program-pick-check', status === 'completed' ? '✓' : status === 'incomplete' ? '…' : '', item)
    setTextContent('.program-pick-name', pick.program.name, item)
    setTextContent('.program-pick-meta', pickMeta(pick), item)
    setTextContent(
      '.program-pick-action',
      pick.isExtra ? 'Extra ›' : pick.isSuggested ? (status === 'incomplete' ? 'Continue ›' : 'Start ›') : '›',
      item
    )
    list.appendChild(item)
  }
}
