import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore, type ExerciseSetExecution } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { keepScreenAwake } from './keepScreenAwake'
import { sendBreakFinishedNotification } from './notification'
import WorkoutSessionForm from './WorkoutSessionForm'

keepScreenAwake()

const urlParams = new URLSearchParams(window.location.search)
const workoutSessionProgramId = urlParams.get('programId')
const workoutSessionDate = urlParams.get('date')

let exercisesCompletedCount = 0

if (!workoutSessionProgramId || !workoutSessionDate) {
  window.location.href = '/'
  throw new Error('Workout session programId and date are required')
}

const appHeaderTitle = document.querySelector('.app-header-title') as HTMLHeadingElement
const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement
const breakCountdownDialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
const countdown = breakCountdownDialog.querySelector('#countdown') as HTMLHeadingElement
const skipBreakButton = breakCountdownDialog.querySelector('#skip-break') as HTMLButtonElement
let countdownInterval: ReturnType<typeof setInterval> | null = null

skipBreakButton.addEventListener('click', () => {
  if (countdownInterval !== null) clearInterval(countdownInterval)
  breakCountdownDialog.close()
})

let existingWorkoutSession = await workoutSessionsStore.getWorkoutSession(workoutSessionDate)
const program = await programsStore.getProgram(workoutSessionProgramId)

if (!program) {
  window.location.href = '/'
  throw new Error('Program not found')
}

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
        countdown.textContent = '2:30'

        countdownInterval = setInterval(() => {
          const minutes = parseInt(countdown.textContent.split(':')[0])
          const seconds = parseInt(countdown.textContent.split(':')[1])

          if (minutes === 0 && seconds === 0) {
            sendBreakFinishedNotification()
            breakCountdownDialog.close()
            if (countdownInterval !== null) clearInterval(countdownInterval)
          } else if (seconds === 0) {
            const nextMinutes = minutes - 1
            countdown.textContent = `${nextMinutes}:59`
          } else {
            const nextSeconds = seconds - 1
            countdown.textContent = `${minutes}:${nextSeconds < 10 ? `0${nextSeconds}` : nextSeconds}`
          }
        }, 1000)

        breakCountdownDialog.showModal()
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

new WorkoutSessionForm({ programId: workoutSessionProgramId, workoutSessionDate }).on(
  'workout-session-updated',
  ({ detail: { workoutSession } }) => {
    existingWorkoutSession = workoutSession
    workoutDetails.removeAttribute('open')
  }
)

renderProgramExercises()
