import '../../style.css'
import { db } from '../../db'
import type { Exercise } from '../../db/stores/exercisesStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'
import ExercisesState from '../../state/ExercisesState'
import ExerciseList from '../exercises/ExerciseList'
import AddExerciseDialog from './AddExerciseDialog'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog, { updateSetItem } from './EditSetDialog'
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

  const { program, workoutSession: _workoutSession } = await parseUrlParams()

  setTextContent('.app-header-title', program.name)

  let workoutSession = _workoutSession
  let exerciseClickedListenerInitialized = false
  const exerciseDefinitions = new Map<string, Exercise>()

  const isWorkoutComplete = () => {
    if (!workoutSession) return false
    return workoutSession.exercises.every(({ exerciseId, sets }) => {
      const def = exerciseDefinitions.get(exerciseId)
      return def !== undefined && sets.length >= def.sets
    })
  }

  const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
  const deleteWorkoutSessionBtn = document.querySelector('#delete-workout-session-btn') as HTMLButtonElement
  const addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement

  if (workoutSession) {
    workoutDetails.removeAttribute('open')
  }

  const breakTimerDialog = new BreakTimerDialog()
  breakTimerDialog.on('break-finished', () => {
    sendBreakFinishedNotification()
  })

  const editSetDialog = new EditSetDialog()
  editSetDialog.on('set-edited', ({ detail }) => {
    workoutSession = detail.workoutSession
    updateSetItem(detail)
  })

  const addExerciseDialog = new AddExerciseDialog()
  addExerciseCard.addEventListener('click', () => {
    addExerciseDialog.openDialog()
  })

  ExercisesState.initialize()
  ExerciseList.init()

  const initAddExerciseListener = () => {
    window.addEventListener('exercise-clicked', async (e) => {
      if (!workoutSession) return

      const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
      workoutSession = await workoutSessionsStore.addExerciseToWorkoutSession({
        workoutSession,
        exerciseId: exercise.id
      })
      renderProgramExercises()
      addExerciseDialog.closeDialog()
    })
    exerciseClickedListenerInitialized = true
  }

  if (workoutSession) {
    initAddExerciseListener()
  }

  const workoutSessionForm = new WorkoutSessionForm({ programId: program.id, existingSession: workoutSession })

  workoutSessionForm.on('workout-session-updated', ({ detail }) => {
    workoutSession = detail.workoutSession
    window.history.pushState({}, '', `?id=${workoutSession.id}`)
    renderProgramExercises()
    updateDeleteWorkoutSessionBtnVisibility()

    if (!exerciseClickedListenerInitialized) {
      initAddExerciseListener()
    }

    workoutDetails.removeAttribute('open')
  })

  const renderProgramExercises = async () => {
    const scrollY = window.scrollY
    const openExerciseId = document.querySelector<HTMLDetailsElement>('.exercise-details[open]')
      ?.closest<HTMLDivElement>('[data-exercise-id]')
      ?.dataset.exerciseId

    exercisesList.innerHTML = ''
    exerciseDefinitions.clear()
    let exerciseIds: Exercise['id'][] = program.exercises

    if (workoutSession && (workoutSession.status === 'completed' || workoutSession.status === 'incomplete')) {
      exerciseIds = workoutSession.exercises.map(({ exerciseId }) => exerciseId)
    }

    for (const exerciseId of exerciseIds) {
      const exercise = await db.exercises.getById(exerciseId)

      if (!exercise) continue

      exerciseDefinitions.set(exerciseId, exercise)
      const card = await renderExerciseCard({
        exercise,
        programId: program.id,
        programExerciseIds: program.exercises,
        getSession: () => workoutSession,
        setSession: (s) => {
          workoutSession = s
        },
        editSetDialog,
        breakTimerDialog,
        isWorkoutComplete,
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
    if (!workoutSession) return

    const confirmed = confirm('Are you sure you want to delete this workout session?')
    if (!confirmed) return

    await workoutSessionsStore.deleteWorkoutSession(workoutSession.id)
    Toasts.show({ message: 'Workout session deleted' })
    window.location.href = `/workouts/`
  })

  const updateDeleteWorkoutSessionBtnVisibility = () => {
    if (workoutSession) {
      deleteWorkoutSessionBtn.classList.remove('hidden')
    } else {
      deleteWorkoutSessionBtn.classList.add('hidden')
    }
  }

  renderProgramExercises()
  updateDeleteWorkoutSessionBtnVisibility()
}

init().catch((error) => {
  console.error('Failed to initialize gymtime page:', error)
  showError('Could not load workout. The program or session may no longer exist.')
})
