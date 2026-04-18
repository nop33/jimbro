import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { setTextContent } from '../../utils'

class StatsPage {
  constructor() {
    this.init()
  }

  private async init() {
    await this.calculateAndRenderStats()
  }

  private async calculateAndRenderStats() {
    const sessions = await workoutSessionsStore.getAllWorkoutSessions()

    let totalCompletedSessions = 0
    let totalUncompletedSessions = 0
    let totalWeightLifted = 0
    let totalExercisesCompleted = 0
    let totalSetsCompleted = 0
    let totalRepsCompleted = 0
    const uniqueDaysWorkedOut = new Set<string>()

    for (const session of sessions) {
      if (session.status === 'completed') {
        totalCompletedSessions++

        const dateStr = session.date.split('T')[0]
        uniqueDaysWorkedOut.add(dateStr)

        for (const exercise of session.exercises) {
          totalExercisesCompleted++

          for (const set of exercise.sets) {
            totalSetsCompleted++
            totalRepsCompleted += set.reps
            totalWeightLifted += set.weight * set.reps
          }
        }
      } else {
        totalUncompletedSessions++
      }
    }

    const totalDaysWorkedOut = uniqueDaysWorkedOut.size

    let averageWorkoutsPerWeek = 0
    if (totalCompletedSessions > 0) {
      const sortedDates = Array.from(uniqueDaysWorkedOut)
        .map((d) => new Date(d).getTime())
        .sort((a, b) => a - b)

      if (sortedDates.length > 0) {
        const firstDate = sortedDates[0]
        const lastDate = sortedDates[sortedDates.length - 1]
        const daysSpan = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24))
        const weeksSpan = daysSpan / 7
        averageWorkoutsPerWeek = Math.max(
          weeksSpan > 0 ? totalCompletedSessions / weeksSpan : totalCompletedSessions,
          0
        )
      }
    }

    const formatNumber = (num: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(num)

    setTextContent('#stat-completed-sessions', formatNumber(totalCompletedSessions))
    setTextContent('#stat-total-volume', formatNumber(totalWeightLifted))
    setTextContent('#stat-total-exercises', formatNumber(totalExercisesCompleted))
    setTextContent('#stat-total-sets', formatNumber(totalSetsCompleted))
    setTextContent('#stat-total-reps', formatNumber(totalRepsCompleted))
    setTextContent('#stat-days-active', formatNumber(totalDaysWorkedOut))
    setTextContent('#stat-avg-workouts', formatNumber(averageWorkoutsPerWeek))

    const uncompletedEl = document.getElementById('stat-uncompleted-sessions')
    if (uncompletedEl) {
      if (totalUncompletedSessions > 0) {
        uncompletedEl.textContent = `+${totalUncompletedSessions} uncompleted`
        uncompletedEl.classList.remove('hidden')
      } else {
        uncompletedEl.classList.add('hidden')
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new StatsPage()
})
