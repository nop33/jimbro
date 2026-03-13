import '../../style.css'
import { db } from '../../db'
import type { Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'
import ExercisesState from '../../state/ExercisesState'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import ExerciseList from '../exercises/ExerciseList'
import AddExerciseDialog from './AddExerciseDialog'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import { renderExerciseCard } from './ExerciseCard'
import { keepScreenAwake } from './keepScreenAwake'
import { sendBreakFinishedNotification } from './notification'
import { parseUrlParams } from './parseUrlParams'
import WorkoutSessionForm from './WorkoutSessionForm'

const showError = (message: string) => {
  const pageContent = document.querySelector('.app-page-content') as HTMLDivElement
  pageContent.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <p class="text-lg text-jim-error">${message}</p>
      <a href="/workouts/" class="btn-primary">Back to workouts</a>
    </div>
  `
}

const init = async () => {
  keepScreenAwake()

  const { program, workoutSession } = await parseUrlParams()

  GymtimeSessionState.initialize(workoutSession)

  setTextContent('.app-header-title', program.name)

  const exerciseDefinitions = new Map<string, Exercise>()

  const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
  const deleteWorkoutSessionBtn = document.querySelector('#delete-workout-session-btn') as HTMLButtonElement
  const addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement

  if (GymtimeSessionState.session) {
    workoutDetails.removeAttribute('open')
  }

  const breakTimerDialog = new BreakTimerDialog()
  breakTimerDialog.on('break-finished', () => {
    sendBreakFinishedNotification()
  })

  const editSetDialog = new EditSetDialog()

  const addExerciseDialog = new AddExerciseDialog()
  addExerciseCard.addEventListener('click', () => {
    addExerciseDialog.openDialog()
  })

  ExercisesState.initialize()
  ExerciseList.init()

  window.addEventListener('exercise-clicked', async (e) => {
    if (!GymtimeSessionState.session) return

    const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
    await GymtimeSessionState.addExercise(exercise.id)
    renderProgramExercises()
    addExerciseDialog.closeDialog()
  })

  const workoutSessionForm = new WorkoutSessionForm(program.id)

  workoutSessionForm.on('session-saved', () => {
    const session = GymtimeSessionState.session
    if (session) window.history.pushState({}, '', `?id=${session.id}`)
    renderProgramExercises()
    updateDeleteWorkoutSessionBtnVisibility()
    workoutDetails.removeAttribute('open')
  })

  const renderProgramExercises = async () => {
    const scrollY = window.scrollY
    const openExerciseId = document
      .querySelector<HTMLDetailsElement>('.exercise-details[open]')
      ?.closest<HTMLDivElement>('[data-exercise-id]')?.dataset.exerciseId

    exercisesList.innerHTML = ''
    exerciseDefinitions.clear()

    const session = GymtimeSessionState.session
    let exerciseIds: Exercise['id'][] = program.exercises

    if (session && (session.status === 'completed' || session.status === 'incomplete')) {
      exerciseIds = session.exercises.map(({ exerciseId }) => exerciseId)
    }

    for (const exerciseId of exerciseIds) {
      const exercise = await db.exercises.getById(exerciseId)

      if (!exercise) continue

      exerciseDefinitions.set(exerciseId, exercise)
      const card = await renderExerciseCard({
        exercise,
        programId: program.id,
        programExerciseIds: program.exercises,
        exerciseDefinitions,
        editSetDialog,
        breakTimerDialog,
        onExerciseDeleted: () => renderProgramExercises()
      })
      exercisesList.appendChild(card)
    }

    if (openExerciseId) {
      const details = exercisesList.querySelector<HTMLDetailsElement>(
        `[data-exercise-id="${openExerciseId}"] .exercise-details`
      )
      details?.setAttribute('open', '')
    }

    window.scrollTo(0, scrollY)
  }

  deleteWorkoutSessionBtn.addEventListener('click', async () => {
    if (!GymtimeSessionState.session) return

    if (!confirm('Are you sure you want to delete this workout session?')) return

    await GymtimeSessionState.delete()
    Toasts.show({ message: 'Workout session deleted' })
    window.location.href = `/workouts/`
  })

  const updateDeleteWorkoutSessionBtnVisibility = () => {
    deleteWorkoutSessionBtn.classList.toggle('hidden', !GymtimeSessionState.session)
  }

  renderProgramExercises()
  updateDeleteWorkoutSessionBtnVisibility()
}

init().catch((error) => {
  console.error('Failed to initialize gymtime page:', error)
  showError('Could not load workout. The program or session may no longer exist.')
})
