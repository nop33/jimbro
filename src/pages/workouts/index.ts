import { db } from '../../db'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { extractWeekKeyNumbers, getSimpleDate, getWeekOfYear, getWeeksKeysFromDateToNow } from '../../dateUtils'
import IntroText from './IntroText'
import NewWorkoutDialog from './NewWorkoutDialog'
import WorkoutModeDialog from './WorkoutModeDialog'
import { isDbEmpty } from '../../db/utils'
import Toasts from '../../features/toasts'
import { getWorkoutModeSettings, getEffectiveWorkoutsPerWeek } from '../../settings'

const workoutWeeksContainer = document.getElementById('workout-weeks') as HTMLDivElement

const workoutWeeks = await workoutSessionsStore.getAllWorkoutSessionsGroupedByWeek()
const programNames = await db.programs.getNameMap()
const _isDbEmpty = await isDbEmpty()
const settings = getWorkoutModeSettings()
const programCount = Object.keys(programNames).length
const workoutsPerWeek = getEffectiveWorkoutsPerWeek(programCount)

await IntroText.render()
NewWorkoutDialog.init()
WorkoutModeDialog.init()

const todayDate = new Date()
const today = getSimpleDate(todayDate)
const currentWeekKey = getWeekOfYear(todayDate)
const dateOfFirstWorkoutSession = (await workoutSessionsStore.getDateOfFirstWorkoutSession()) ?? today
const weeksKeys = getWeeksKeysFromDateToNow(new Date(dateOfFirstWorkoutSession)).reverse()

const renderWorkoutSession = (workoutSession: WorkoutSession | PendingOrSkippedWorkoutSession) => {
  const workoutItemTemplate = nodeFromTemplate('#workout-item-template')
  const workoutStatus = workoutItemTemplate.querySelector('.workout-status') as HTMLParagraphElement
  const workoutDate = workoutItemTemplate.querySelector('.workout-date') as HTMLParagraphElement

  setTextContent('.workout-title', programNames[workoutSession.programId], workoutItemTemplate)

  if (workoutSession.status !== 'completed') {
    setTextContent('.workout-status', workoutSession.status, workoutItemTemplate)

    if (workoutSession.status === 'incomplete') {
      workoutStatus.classList.add('text-jim-warning')
    } else if (workoutSession.status === 'skipped') {
      workoutStatus.classList.add('text-jim-error')
    }
  }

  if (workoutSession.date) {
    const dateObj = new Date(workoutSession.date)
    const formattedDate = dateObj.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    })
    setTextContent('.workout-date', formattedDate, workoutItemTemplate)
  } else {
    workoutDate.remove()
  }

  const workoutItemDiv = workoutItemTemplate.querySelector('div') as HTMLDivElement
  workoutItemDiv.classList.add(
    {
      completed: 'card-success',
      skipped: 'card-danger',
      incomplete: 'card-warning',
      pending: 'card-pending'
    }[workoutSession.status]
  )

  if (workoutSession.status === 'incomplete') {
    workoutItemDiv.classList.add('border-dashed')
  }

  if (workoutSession.status !== 'skipped') {
    workoutItemDiv.addEventListener('click', () => {
      window.location.href =
        workoutSession.status === 'pending'
          ? `/gymtime/?programId=${workoutSession.programId}`
          : `/gymtime/?id=${workoutSession.id}`
    })
  }

  return workoutItemTemplate
}

if (_isDbEmpty) {
  const seedDbButton = document.createElement('button')
  seedDbButton.classList.add('btn-primary', 'mx-auto')
  seedDbButton.textContent = 'Seed Database'
  seedDbButton.addEventListener('click', async () => {
    try {
      await db.exercises.seed()
      await db.programs.seed()
      window.location.reload()
    } catch (error) {
      console.error('Error seeding database:', error)
      Toasts.show({ message: 'Failed to seed database.', type: 'error' })
    }
  })
  workoutWeeksContainer.appendChild(seedDbButton)
} else {
  weeksKeys.forEach((weekKey) => {
    const workoutsOfThisWeek = workoutWeeks[weekKey] ?? []

    if (settings.mode === 'freestyle' && workoutsOfThisWeek.length === 0 && weekKey !== currentWeekKey) {
      return
    }

    const workoutWeekTemplate = nodeFromTemplate('#workout-week-template')
    const workoutsOfThisWeekList = workoutWeekTemplate.querySelector('.workout-week-list') as HTMLUListElement
    workoutsOfThisWeekList.style.gridTemplateColumns = `repeat(${workoutsPerWeek}, minmax(0, 1fr))`

    const { year, week } = extractWeekKeyNumbers(weekKey)
    setTextContent('.workout-week-week', `Week ${week}`, workoutWeekTemplate)
    setTextContent('.workout-week-year', `of ${year}`, workoutWeekTemplate)

    workoutsOfThisWeek.forEach((workout) => {
      const workoutItem = renderWorkoutSession(workout)
      workoutsOfThisWeekList.appendChild(workoutItem)
    })

    if (settings.mode === 'rotation' && workoutsOfThisWeek.length < workoutsPerWeek) {
      const recordedWorkoutPrograms = workoutsOfThisWeek.map(({ programId }) => programId)
      const missingProgramsIds = Object.keys(programNames).filter(
        (programId) => !recordedWorkoutPrograms.includes(programId)
      )

      missingProgramsIds.forEach((missingProgramId) => {
        const status = weekKey === currentWeekKey ? 'pending' : 'skipped'
        const workoutItem = renderWorkoutSession({
          programId: missingProgramId,
          status: status,
          exercises: [],
          location: '',
          date: undefined
        })
        workoutsOfThisWeekList.appendChild(workoutItem)
      })
    }

    workoutWeeksContainer.appendChild(workoutWeekTemplate)
  })
}

type PendingOrSkippedWorkoutSession = Omit<WorkoutSession, 'id' | 'date'> & {
  id?: undefined
  date?: undefined
  status: 'pending' | 'skipped'
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload()
  }
})

// Fallback for browsers that don't trigger pageshow event properly
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    window.location.reload()
  }
})
