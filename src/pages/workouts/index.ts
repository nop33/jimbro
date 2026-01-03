import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { extractWeekKeyNumbers, getSimpleDate, getWeekOfYear, getWeeksKeysFromDateToNow } from '../../dateUtils'
import IntroText from './IntroText'
import NewWorkoutDialog from './NewWorkoutDialog'

IntroText.render()
NewWorkoutDialog.init()

const WORKOUTS_PER_WEEK = 3

const workoutWeeksContainer = document.getElementById('workout-weeks') as HTMLDivElement

const workoutWeeks = await workoutSessionsStore.getAllWorkoutSessionsGroupedByWeek()
const programNames = await programsStore.getProgramsByNames()

const today = getSimpleDate(new Date())
const dateOfFirstWorkoutSession = (await workoutSessionsStore.getDateOfFirstWorkoutSession()) ?? today
const weeksKeys = getWeeksKeysFromDateToNow(new Date(dateOfFirstWorkoutSession)).reverse()

const renderWorkoutSession = (workoutSession: WorkoutSession | PendingOrSkippedWorkoutSession) => {
  const workoutItemTemplate = nodeFromTemplate('#workout-item-template')
  setTextContent('.workout-title', programNames[workoutSession.programId], workoutItemTemplate)
  setTextContent('.workout-status', workoutSession.status, workoutItemTemplate)

  if (workoutSession.date) {
    setTextContent('.workout-date', new Date(workoutSession.date).toLocaleDateString(), workoutItemTemplate)
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

type PendingOrSkippedWorkoutSession = Omit<WorkoutSession, 'date'> & { date: undefined; status: 'pending' | 'skipped' }
