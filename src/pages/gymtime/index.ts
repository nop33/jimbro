import { getSimpleDate } from '../../dateUtils'
import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import {
  workoutSessionsStore,
  type ExerciseSetExecution,
  type WorkoutSession
} from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import BreakTimerDialog from './BreakTimerDialog'
import { keepScreenAwake } from './keepScreenAwake'
import { sendBreakFinishedNotification } from './notification'
import WorkoutSessionForm from './WorkoutSessionForm'

keepScreenAwake()

const urlParams = new URLSearchParams(window.location.search)
const workoutSessionProgramId = urlParams.get('programId')
const workoutSessionDate = urlParams.get('date')

let exercisesCompletedCount = 0
let program: Program | undefined
let existingWorkoutSession: WorkoutSession | undefined = undefined

if (!workoutSessionProgramId && !workoutSessionDate) {
  window.location.href = '/'
  throw new Error('Workout session programId or date is required')
} else if (workoutSessionProgramId) {
  program = await programsStore.getProgram(workoutSessionProgramId)
  existingWorkoutSession = undefined
} else if (workoutSessionDate) {
  existingWorkoutSession = await workoutSessionsStore.getWorkoutSession(workoutSessionDate)
  program = existingWorkoutSession?.programId
    ? await programsStore.getProgram(existingWorkoutSession.programId)
    : undefined
}

if (!program) {
  window.location.href = '/'
  throw new Error('Program not found')
}

const appHeaderTitle = document.querySelector('.app-header-title') as HTMLHeadingElement
const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement

const breakTimerDialog = new BreakTimerDialog()
breakTimerDialog.on('break-finished', () => {
  sendBreakFinishedNotification()
})

appHeaderTitle.textContent = program.name

const renderCompletedSetItem = ({ set, index }: { set: ExerciseSetExecution; index: number }) => {
  const completedSetItemTemplate = nodeFromTemplate('#completed-set-item-template')
  setTextContent('.set-reps', set.reps.toString(), completedSetItemTemplate)
  setTextContent('.set-weight', set.weight.toString(), completedSetItemTemplate)
  setTextContent('.set-number', (index + 1).toString(), completedSetItemTemplate)
  return completedSetItemTemplate
}

const renderProgramExerciseCard = async (programExercise: Exercise) => {
  const exerciseItemTemplate = nodeFromTemplate('#exercise-item-template')
  const exerciseDetails = exerciseItemTemplate.querySelector('.exercise-details') as HTMLDetailsElement
  const completedSets = exerciseDetails.querySelector('.completed-sets') as HTMLDivElement
  const exerciseItemDiv = exerciseItemTemplate.querySelector('div') as HTMLDivElement
  const nextSetDiv = exerciseItemTemplate.querySelector('.next-set') as HTMLDivElement

  setTextContent('.exercise-name', programExercise.name, exerciseItemTemplate)
  setTextContent('.exercise-muscle', programExercise.muscle, exerciseItemTemplate)

  const existingWorkoutSessionExercise = existingWorkoutSession?.exercises.find(
    ({ exerciseId }) => exerciseId === programExercise.id
  )

  if (existingWorkoutSessionExercise) {
    // Set card colors
    if (existingWorkoutSessionExercise.sets.length === programExercise.sets) {
      exerciseItemDiv.classList.add('card-success')
      exercisesCompletedCount++
    }

    // Set card completed sets
    for (const [index, set] of existingWorkoutSessionExercise.sets.entries()) {
      completedSets.appendChild(renderCompletedSetItem({ set, index }))
    }
  }

  if (!existingWorkoutSessionExercise || existingWorkoutSessionExercise.sets.length < programExercise.sets) {
    // Set next set form
    const nextSetForm = exerciseItemTemplate.querySelector('.next-set-form') as HTMLFormElement
    const nextSetRepsInput = nextSetForm.querySelector('input[name="set-reps"]') as HTMLInputElement
    const nextSetWeightInput = nextSetForm.querySelector('input[name="set-weight"]') as HTMLInputElement

    let latestSet = existingWorkoutSession?.exercises
      .find(({ exerciseId }) => exerciseId === programExercise.id)
      ?.sets.at(-1)

    if (!latestSet) {
      const latestWorkoutSessionOfProgram = await workoutSessionsStore.getLatestCompletedWorkoutSessionOfProgram(
        program.id
      )
      latestSet = latestWorkoutSessionOfProgram?.exercises
        .find(({ exerciseId }) => exerciseId === programExercise.id)
        ?.sets.at(-1)

      latestSet = latestSet ?? { reps: programExercise.reps, weight: 0 }
    }

    nextSetRepsInput.value = latestSet.reps.toString()
    nextSetWeightInput.value = latestSet.weight.toString()

    nextSetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const formData = new FormData(nextSetForm)
      const reps = formData.get('set-reps') as string
      const weight = formData.get('set-weight') as string

      if (!existingWorkoutSession) {
        throw new Error('No existing workout session found')
      }

      const completedSet = { reps: parseFloat(reps), weight: parseFloat(weight) }

      existingWorkoutSession = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
        workoutSession: existingWorkoutSession,
        exerciseId: programExercise.id,
        exerciseExecutionSet: completedSet
      })

      const index =
        (existingWorkoutSession.exercises.find(({ exerciseId: id }) => id === programExercise.id)?.sets.length ?? 1) - 1

      completedSets.appendChild(renderCompletedSetItem({ set: completedSet, index }))

      if (index + 1 === programExercise.sets) {
        exerciseDetails.removeAttribute('open')
        exerciseItemDiv.classList.add('card-success')
        nextSetDiv.remove()
        exercisesCompletedCount++
      }

      if (exercisesCompletedCount === program.exercises.length) {
        existingWorkoutSession = await workoutSessionsStore.updateWorkoutSession({
          ...existingWorkoutSession,
          status: 'completed'
        })
      } else {
        breakTimerDialog.startTimer({ minutes: 2, seconds: 30 })
      }
    })
  } else {
    nextSetDiv.remove()
  }

  return exerciseItemTemplate
}

const renderProgramExercises = async () => {
  for (const exerciseId of program.exercises) {
    const programExercise = await exercisesStore.getExercise(exerciseId)

    if (!programExercise) continue

    const exerciseListItem = await renderProgramExerciseCard(programExercise)
    exercisesList.appendChild(exerciseListItem)
  }
}

new WorkoutSessionForm({
  programId: program.id,
  workoutSessionDate: existingWorkoutSession?.date ?? getSimpleDate(new Date())
}).on('workout-session-updated', ({ detail: { workoutSession } }) => {
  existingWorkoutSession = workoutSession
  workoutDetails.removeAttribute('open')
})

renderProgramExercises()
