import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { extractWeekKeyNumbers, getSimpleDate, getWeekOfYear, getWeeksKeysFromDateToNow } from '../../dateUtils'
import IntroText from './IntroText'
import NewWorkoutDialog from './NewWorkoutDialog'
import { isDbEmpty } from '../../db/utils'
import { exercisesStore } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'

const WORKOUTS_PER_WEEK = 3

const workoutWeeksContainer = document.getElementById('workout-weeks') as HTMLDivElement

const workoutWeeks = await workoutSessionsStore.getAllWorkoutSessionsGroupedByWeek()
const programNames = await programsStore.getProgramsByNames()
const _isDbEmpty = await isDbEmpty()

IntroText.render()
NewWorkoutDialog.init()

const today = getSimpleDate(new Date())
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
          : `/gymtime/?date=${workoutSession.date}`
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
      await exercisesStore.seedExercises()
      await programsStore.seedPrograms()
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
    const workoutWeekTemplate = nodeFromTemplate('#workout-week-template')
    const workoutsOfThisWeekList = workoutWeekTemplate.querySelector('#workout-week-list') as HTMLUListElement

    const { year, week } = extractWeekKeyNumbers(weekKey)
    setTextContent('.workout-week-week', `Week ${week}`, workoutWeekTemplate)
    setTextContent('.workout-week-year', `of ${year}`, workoutWeekTemplate)

    workoutsOfThisWeek.forEach((workout) => {
      const workoutItem = renderWorkoutSession(workout)
      workoutsOfThisWeekList.appendChild(workoutItem)
    })

    if (workoutsOfThisWeek.length < WORKOUTS_PER_WEEK) {
      const recordedWorkoutPrograms = workoutsOfThisWeek.map(({ programId }) => programId)
      const missingProgramsIds = Object.keys(programNames).filter(
        (programId) => !recordedWorkoutPrograms.includes(programId)
      )
      const currentWeek = extractWeekKeyNumbers(getWeekOfYear(new Date())).week

      missingProgramsIds.forEach((missingProgramId) => {
        const status = week === currentWeek ? 'pending' : 'skipped'
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

type PendingOrSkippedWorkoutSession = Omit<WorkoutSession, 'date'> & { date: undefined; status: 'pending' | 'skipped' }
