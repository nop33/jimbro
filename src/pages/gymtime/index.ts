import { getSimpleDate } from '../../dateUtils'
import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { workoutSessionsStore, type ExerciseSetExecution } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import BreakTimerDialog from './BreakTimerDialog'
import { keepScreenAwake } from './keepScreenAwake'
import { sendBreakFinishedNotification } from './notification'
import { parseUrlParams } from './parseUrlParams'
import WorkoutSessionForm from './WorkoutSessionForm'

keepScreenAwake()

const { program, workoutSession: _workoutSession } = await parseUrlParams()

setTextContent('.app-header-title', program.name)

let workoutSession = _workoutSession
let exercisesCompletedCount = 0

const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement

const breakTimerDialog = new BreakTimerDialog()
breakTimerDialog.on('break-finished', () => {
  sendBreakFinishedNotification()
})

const workoutSessionDate = workoutSession?.date ?? getSimpleDate(new Date())
const workoutSessionForm = new WorkoutSessionForm({ programId: program.id, workoutSessionDate })

workoutSessionForm.on('workout-session-updated', ({ detail }) => {
  workoutSession = detail.workoutSession

  const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement
  workoutDetails.removeAttribute('open')
})

const renderSetItem = ({
  set,
  index,
  isCompleted = true
}: {
  set: ExerciseSetExecution | { reps: string; weight: string }
  index: number
  isCompleted?: boolean
}) => {
  const completedSetItemTemplate = nodeFromTemplate('#completed-set-item-template')
  const completedSetItemTemplateDiv = completedSetItemTemplate.querySelector('div') as HTMLDivElement
  const setNumber = (index + 1).toString()

  setTextContent('.set-reps', set.reps.toString(), completedSetItemTemplate)
  setTextContent('.set-weight', set.weight.toString(), completedSetItemTemplate)
  setTextContent('.set-number', setNumber, completedSetItemTemplate)

  if (isCompleted) {
    completedSetItemTemplateDiv.classList.add('isCompleted')
  } else {
    completedSetItemTemplateDiv.classList.add('isPending')
  }

  completedSetItemTemplateDiv.setAttribute('data-set-number', setNumber)

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

  const existingWorkoutSessionExercise = workoutSession?.exercises.find(
    ({ exerciseId }) => exerciseId === programExercise.id
  )

  if (existingWorkoutSessionExercise) {
    // Set card colors
    if (existingWorkoutSessionExercise.sets.length === programExercise.sets) {
      exerciseItemDiv.classList.add('card-success')
      exercisesCompletedCount++
    }

    // Set card completed sets
    let count = 0
    for (const [index, set] of existingWorkoutSessionExercise.sets.entries()) {
      completedSets.appendChild(renderSetItem({ set, index }))
      count++
    }

    for (let i = count; i < programExercise.sets; i++) {
      completedSets.appendChild(renderSetItem({ set: { reps: '-', weight: '-' }, index: i, isCompleted: false }))
    }
  }

  if (!existingWorkoutSessionExercise || existingWorkoutSessionExercise.sets.length < programExercise.sets) {
    // Set next set form
    const nextSetForm = exerciseItemTemplate.querySelector('.next-set-form') as HTMLFormElement
    const nextSetRepsInput = nextSetForm.querySelector('input[name="set-reps"]') as HTMLInputElement
    const nextSetWeightInput = nextSetForm.querySelector('input[name="set-weight"]') as HTMLInputElement

    let latestSet = workoutSession?.exercises.find(({ exerciseId }) => exerciseId === programExercise.id)?.sets.at(-1)

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

      if (!workoutSession) {
        throw new Error('No existing workout session found')
      }

      const completedSet = { reps: parseFloat(reps), weight: parseFloat(weight) }

      workoutSession = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
        workoutSession,
        exerciseId: programExercise.id,
        exerciseExecutionSet: completedSet
      })

      const index =
        (workoutSession.exercises.find(({ exerciseId: id }) => id === programExercise.id)?.sets.length ?? 1) - 1

      const pendingSetItem = completedSets.querySelector(`[data-set-number="${index + 1}"]`) as HTMLDivElement
      pendingSetItem.classList.remove('isPending')
      pendingSetItem.classList.add('isCompleted')
      setTextContent('.set-reps', completedSet.reps.toString(), pendingSetItem)
      setTextContent('.set-weight', completedSet.weight.toString(), pendingSetItem)

      if (index + 1 === programExercise.sets) {
        exerciseDetails.removeAttribute('open')
        exerciseItemDiv.classList.add('card-success')
        nextSetDiv.remove()
        exercisesCompletedCount++
      }

      if (exercisesCompletedCount === program.exercises.length) {
        workoutSession = await workoutSessionsStore.updateWorkoutSession({ ...workoutSession, status: 'completed' })
      } else {
        breakTimerDialog.startTimer({ minutes: 0, seconds: 3 })
      }
    })
  } else {
    nextSetDiv.remove()
  }

  return exerciseItemTemplate
}

const renderProgramExercises = async () => {
  let exerciseIds: Exercise['id'][] = program.exercises

  if (workoutSession && (workoutSession.status === 'completed' || workoutSession.status === 'incomplete')) {
    exerciseIds = workoutSession.exercises.map(({ exerciseId }) => exerciseId)
  } else {
    exerciseIds = program.exercises
  }

  for (const exerciseId of exerciseIds) {
    const programExercise = await exercisesStore.getExercise(exerciseId)

    if (!programExercise) continue

    const exerciseListItem = await renderProgramExerciseCard(programExercise)
    exercisesList.appendChild(exerciseListItem)
  }
}

renderProgramExercises()
