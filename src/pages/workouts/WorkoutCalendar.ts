import { parseSimpleDate } from '../../dateUtils'
import type { WorkoutSession } from '../../db/types'
import { nodeFromTemplate, setTextContent } from '../../utils'
import type { CalendarDay, CalendarWeek } from './calendar'

const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })
const fullMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const workouts = (count: number) => `${count} ${count === 1 ? 'workout' : 'workouts'}`

const weekLabel = ({ week, state, counted, ahead, month }: CalendarWeek, goal: number) => {
  const progress = `${workouts(counted)}${ahead > 0 ? `, ${ahead} of them done ahead the week before` : ''}`
  const status = {
    met: `goal met, ${progress}`,
    current: `this week, ${counted} of ${goal} so far${ahead > 0 ? `, ${ahead} done ahead` : ''}`,
    partial: `goal missed, ${progress}`,
    missed: 'no workouts',
    next: 'next week'
  }[state]
  return `${month ? `${fullMonth.format(parseSimpleDate(month))}. ` : ''}Week ${week.number}, ${status}`
}

const workoutLabel = (workout: WorkoutSession, name: string, extra: boolean) =>
  `${name}, ${workout.status === 'completed' ? 'done' : 'started'}${extra ? ', counts toward next week' : ''}`

// The workouts calendar (calendar.ts): one row per week, a band that is green once the week met its goal and pale
// green while it has workouts short of it, with the month on the left of its first week. A workout day shows a check
// with its program's label over it (calendarLabels), and opens the workout. A day with more than one opens a popover
// that lists them.
export const renderWorkoutCalendar = (
  list: HTMLOListElement,
  weeks: Array<CalendarWeek>,
  goal: number,
  programNames: Record<string, string>,
  labels: Record<string, string>,
  today: string
) => {
  const thisYear = parseSimpleDate(today).getFullYear()
  const nameOf = (workout: WorkoutSession) => programNames[workout.programId] ?? 'Workout'

  const renderDay = (day: CalendarDay) => {
    const date = parseSimpleDate(day.date)
    const { shown } = day
    const item = nodeFromTemplate(shown ? '#calendar-workout-template' : '#calendar-day-template')
    const li = item.querySelector('li') as HTMLLIElement
    if (day.isToday) li.setAttribute('aria-current', 'date')
    if (!shown) {
      setTextContent('.calendar-date', String(date.getDate()), item)
      return item
    }

    const opener = li.querySelector('.calendar-workout') as HTMLAnchorElement
    opener.dataset.status = shown.status
    setTextContent('.calendar-name', labels[shown.programId] ?? nameOf(shown), item)
    ;(li.querySelector('.calendar-extra') as HTMLElement).hidden = !day.extra
    const label = `${longDay.format(date)}: ${day.workouts.map((workout) => workoutLabel(workout, nameOf(workout), day.extra && workout === shown)).join(' and ')}`

    if (day.workouts.length === 1) {
      opener.href = `/gymtime/?id=${shown.id}`
      opener.setAttribute('aria-label', label)
      return item
    }

    // More than one workout that day: the cell becomes a button for a popover with a link to each.
    const button = document.createElement('button')
    button.type = 'button'
    button.className = opener.className
    button.dataset.status = shown.status
    button.append(...opener.childNodes)
    button.setAttribute('aria-label', label)
    opener.replaceWith(button)
    const count = li.querySelector('.calendar-count') as HTMLElement
    count.textContent = String(day.workouts.length)
    count.hidden = false

    const popover = nodeFromTemplate('#calendar-popover-template').querySelector('[popover]') as HTMLDivElement
    popover.id = `calendar-day-${day.date}`
    setTextContent('.calendar-popover-title', longDay.format(date), popover)
    const links = popover.querySelector('ul') as HTMLUListElement
    for (const workout of day.workouts) {
      const link = document.createElement('a')
      link.href = `/gymtime/?id=${workout.id}`
      link.className = 'calendar-popover-link'
      const name = document.createElement('span')
      name.className = 'truncate'
      name.textContent = nameOf(workout)
      const status = document.createElement('span')
      status.className = 'calendar-popover-status'
      status.dataset.status = workout.status
      status.textContent = workout.status === 'completed' ? 'Done' : 'Started'
      link.append(name, status)
      const entry = document.createElement('li')
      entry.append(link)
      links.append(entry)
    }
    button.setAttribute('popovertarget', popover.id)
    li.append(popover)
    return item
  }

  for (const week of weeks) {
    const item = nodeFromTemplate('#calendar-week-template')
    const row = item.querySelector('li') as HTMLLIElement
    row.dataset.state = week.state
    if (week.counted > 0) row.dataset.started = ''
    setTextContent('.calendar-week-label', weekLabel(week, goal), item)
    if (week.month) {
      const first = parseSimpleDate(week.month)
      const month = row.querySelector('.calendar-month') as HTMLSpanElement
      month.textContent = shortMonth.format(first)
      // A month of another year names its year under it.
      if (first.getFullYear() !== thisYear) {
        const year = document.createElement('span')
        year.className = 'calendar-year'
        year.textContent = String(first.getFullYear())
        month.append(year)
      }
    }
    if (week.ahead > 0) {
      const ahead = row.querySelector('.calendar-ahead') as HTMLSpanElement
      ahead.textContent = `+${week.ahead} ahead`
      ahead.hidden = false
    }
    const days = row.querySelector('.calendar-days') as HTMLOListElement
    for (const day of week.days) days.appendChild(renderDay(day))
    list.appendChild(item)
  }
}
