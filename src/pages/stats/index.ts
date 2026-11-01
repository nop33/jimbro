import { getSimpleDate, parseSimpleDate } from '../../dateUtils'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { trainingTotals } from '../../trainingNumbers'
import { setTextContent } from '../../utils'

async function calculateAndRenderStats() {
  const totals = trainingTotals(await workoutSessionsStore.getAll(), getSimpleDate(new Date()))

  const formatNumber = (num: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(num)

  setTextContent('#stat-completed-sessions', formatNumber(totals.completed))
  setTextContent('#stat-total-volume', formatNumber(Math.floor(totals.volume)))
  setTextContent('#stat-total-exercises', formatNumber(totals.exercises))
  setTextContent('#stat-total-sets', formatNumber(totals.sets))
  setTextContent('#stat-total-reps', formatNumber(totals.reps))
  setTextContent('#stat-days-active', formatNumber(totals.daysActive))
  setTextContent('#stat-avg-workouts', formatNumber(totals.workoutsPerWeek))

  // Working out since
  if (totals.firstDay !== undefined) {
    const firstWorkoutDate = parseSimpleDate(totals.firstDay)

    const dateFormatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(firstWorkoutDate)
    setTextContent('#stat-since-date', dateFormatted)

    const now = new Date()
    const years = now.getFullYear() - firstWorkoutDate.getFullYear()
    const months = now.getMonth() - firstWorkoutDate.getMonth()
    const days = now.getDate() - firstWorkoutDate.getDate()

    let totalMonths = years * 12 + months
    let remainingDays = days
    if (remainingDays < 0) {
      totalMonths--
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0)
      remainingDays += prevMonth.getDate()
    }
    const displayYears = Math.floor(totalMonths / 12)
    const displayMonths = totalMonths % 12

    const parts: string[] = []
    if (displayYears > 0) parts.push(`${displayYears} ${displayYears === 1 ? 'year' : 'years'}`)
    if (displayMonths > 0) parts.push(`${displayMonths} ${displayMonths === 1 ? 'month' : 'months'}`)
    if (remainingDays > 0 || parts.length === 0) parts.push(`${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`)

    setTextContent('#stat-since-duration', parts.join(', '))
  }

  const uncompletedEl = document.getElementById('stat-uncompleted-sessions')
  if (uncompletedEl) {
    if (totals.incomplete > 0) {
      uncompletedEl.textContent = `+${totals.incomplete} incomplete`
      uncompletedEl.classList.remove('hidden')
    } else {
      uncompletedEl.classList.add('hidden')
    }
  }
}

export const mount = calculateAndRenderStats
