import { getSimpleDate, parseSimpleDate } from '../../dateUtils'
import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { getWorkoutModeSettings } from '../../settings'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { reloadWhenStale } from '../reloadWhenStale'
import { buildWeekOverview, daysBetween, type ProgramPick, type WeekOverview } from './weekOverview'

const today = getSimpleDate(new Date())

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const longDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const weekdayLetter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
const kilograms = (kg: number) =>
  `${new Intl.NumberFormat(undefined, { notation: kg >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(kg)} kg`
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const formatDay = (date: string) => dayFormat.format(parseSimpleDate(date))

const lastDoneText = (date: string | undefined) => {
  if (!date) return 'Not done yet'
  const days = daysBetween(date, today)
  if (days === 0) return 'Last done today'
  if (days === 1) return 'Last done yesterday'
  return `Last done ${days} days ago`
}

const renderWeek = ({ days, completed, goal }: WeekOverview) => {
  setTextContent('#week-count', goal > 0 ? `${completed} of ${plural(goal, 'workout')}` : plural(completed, 'workout'))

  const goalBar = document.getElementById('week-goal') as HTMLDivElement
  for (let index = 0; index < goal; index++) {
    const segment = document.createElement('span')
    if (index < completed) segment.classList.add('met')
    goalBar.appendChild(segment)
  }

  const list = document.getElementById('week-days') as HTMLOListElement
  for (const day of days) {
    const item = nodeFromTemplate('#week-day-template')
    const li = item.querySelector('li') as HTMLLIElement
    const date = parseSimpleDate(day.date)
    if (day.status) li.dataset.status = day.status
    if (day.isToday) li.setAttribute('aria-current', 'date')
    setTextContent('.week-day-dot', day.status === 'completed' ? '✓' : String(date.getDate()), item)
    setTextContent('.week-day-name', weekdayLetter.format(date), item)
    const status = { completed: ', workout done', incomplete: ', workout started', none: '' }[day.status ?? 'none']
    setTextContent('.week-day-label', `${longDayFormat.format(date)}${status}`, item)
    list.appendChild(item)
  }
}

const renderHighlights = ({ streak, volume, personalRecords }: WeekOverview) => {
  setTextContent('#streak-value', streak > 0 ? `🔥 ${streak}` : '0')
  setTextContent('#streak-label', `${streak === 1 ? 'week' : 'weeks'} on goal`)

  setTextContent('#volume-value', kilograms(volume.thisWeek))
  const delta = document.getElementById('volume-delta') as HTMLSpanElement
  if (volume.lastWeekSoFar > 0) {
    const change = Math.round(((volume.thisWeek - volume.lastWeekSoFar) / volume.lastWeekSoFar) * 100)
    delta.dataset.trend = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    delta.textContent = `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}% vs last week`
    // Last week counts only up to the same weekday, so a week in progress compares like with like.
    delta.title = `Compared with last week up to the same day: ${kilograms(volume.lastWeekSoFar)}`
  }

  const records = personalRecords.thisWeek
  setTextContent('#records-value', records.length === 1 ? '1 PR' : `${records.length} PRs`)
  const shown = records.at(-1) ?? personalRecords.latest
  setTextContent(
    '#records-detail',
    !shown
      ? ''
      : records.length > 0
        ? `${shown.exerciseName} ${kilograms(shown.weight)}`
        : `Last on ${formatDay(shown.date)}`
  )

  ;(document.getElementById('highlights') as HTMLUListElement).hidden = false
}

const pickMeta = ({ thisWeek, lastCompletedDate }: ProgramPick) => {
  if (thisWeek?.status === 'completed') return `Done ${formatDay(thisWeek.date)}`
  if (thisWeek?.status === 'incomplete') return `Started ${formatDay(thisWeek.date)}`
  return lastDoneText(lastCompletedDate)
}

const renderPicks = ({ picks }: WeekOverview) => {
  if (picks.length === 0) {
    ;(document.getElementById('no-programs') as HTMLParagraphElement).hidden = false
    return
  }

  const list = document.getElementById('program-picks') as HTMLUListElement
  for (const pick of picks) {
    const item = nodeFromTemplate('#program-pick-template')
    const link = item.querySelector('a') as HTMLAnchorElement
    const status = pick.thisWeek?.status
    link.href = status === 'incomplete' ? `/gymtime/?id=${pick.thisWeek?.id}` : `/gymtime/?programId=${pick.program.id}`
    if (status) link.dataset.status = status
    if (pick.isSuggested) link.dataset.suggested = ''
    setTextContent('.program-pick-check', status === 'completed' ? '✓' : status === 'incomplete' ? '…' : '', item)
    setTextContent('.program-pick-name', pick.program.name, item)
    setTextContent('.program-pick-meta', pickMeta(pick), item)
    setTextContent(
      '.program-pick-action',
      pick.isSuggested ? (status === 'incomplete' ? 'Continue ›' : 'Start ›') : '›',
      item
    )
    list.appendChild(item)
  }
}

// Chrome may offer the install before the database answers, so the button listens first.
const installBtn = document.getElementById('install-btn')
let deferredPrompt: Event | null = null

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
})

if (installBtn) {
  installBtn.addEventListener('click', () => {
    if (deferredPrompt && 'prompt' in deferredPrompt && typeof deferredPrompt.prompt === 'function') {
      deferredPrompt.prompt()
    } else {
      alert("To install the app on iOS tap the Share icon in Safari, then select 'Add to Home Screen'.")
    }
  })

  window.addEventListener('appinstalled', () => document.getElementById('install-row')?.remove())
}

const [sessions, programs] = await Promise.all([workoutSessionsStore.getAll(), programsStore.load()])
const overview = buildWeekOverview(sessions, programs, getWorkoutModeSettings())
renderWeek(overview)
if (sessions.length > 0) renderHighlights(overview)
renderPicks(overview)

reloadWhenStale(today)
