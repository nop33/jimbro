import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'

async function initStatsPage() {
  const statsContent = document.getElementById('stats-content')
  if (!statsContent) {
    console.error('Stats content container not found')
    return
  }

  // Fetch all sessions
  const sessions = await workoutSessionsStore.getAllWorkoutSessions()

  let totalCompletedSessions = 0
  let totalUncompletedSessions = 0
  let totalWeightLifted = 0
  let totalExercisesCompleted = 0
  let totalSetsCompleted = 0
  let totalRepsCompleted = 0
  const uniqueDaysWorkedOut = new Set<string>()

  // Process data
  for (const session of sessions) {
    if (session.status === 'completed') {
      totalCompletedSessions++

      // Only count days worked out for completed sessions
      // Strip time portion to get unique days
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

  // Calculate Average Workouts Per Week
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
      averageWorkoutsPerWeek = Math.max(weeksSpan > 0 ? totalCompletedSessions / weeksSpan : totalCompletedSessions, 0)
    }
  }

  // Build the UI
  const formatNumber = (num: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(num)

  statsContent.innerHTML = `
    <div class="flex flex-col gap-4 p-4 pb-24">

      <!-- Workouts Card -->
      <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
        <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Workout Sessions</h2>
        <div class="flex items-end gap-3">
          <span class="text-4xl font-bold text-white">${formatNumber(totalCompletedSessions)}</span>
          ${totalUncompletedSessions > 0 ? `<span class="text-sm text-neutral-500 mb-1">+${totalUncompletedSessions} uncompleted</span>` : ''}
        </div>
      </div>

      <!-- Volume Card -->
      <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
        <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Total Volume</h2>
        <div class="flex items-end gap-3">
          <span class="text-4xl font-bold text-white">${formatNumber(totalWeightLifted)}</span>
          <span class="text-sm text-neutral-500 mb-1">lbs/kg</span>
        </div>
      </div>

      <!-- Exercises & Sets Grid -->
      <div class="grid grid-cols-2 gap-4">
        <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
          <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Exercises</h2>
          <div class="text-3xl font-bold text-white">${formatNumber(totalExercisesCompleted)}</div>
        </div>

        <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
          <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Sets</h2>
          <div class="text-3xl font-bold text-white">${formatNumber(totalSetsCompleted)}</div>
        </div>
      </div>

      <!-- Reps Card -->
      <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
        <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Total Reps</h2>
        <div class="text-3xl font-bold text-white">${formatNumber(totalRepsCompleted)}</div>
      </div>

      <!-- Consistency Grid -->
      <div class="grid grid-cols-2 gap-4">
        <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
          <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Days Active</h2>
          <div class="text-3xl font-bold text-white">${formatNumber(totalDaysWorkedOut)}</div>
        </div>

        <div class="card bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
          <h2 class="text-sm text-neutral-400 font-semibold mb-3 uppercase tracking-wider">Avg Workouts/Wk</h2>
          <div class="text-3xl font-bold text-white">${formatNumber(averageWorkoutsPerWeek)}</div>
        </div>
      </div>

    </div>
  `
}

document.addEventListener('DOMContentLoaded', initStatsPage)
