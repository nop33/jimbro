import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore, type ExerciseSetExecution } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { setCityFromGeolocation } from './geolocation'

const urlParams = new URLSearchParams(window.location.search)
const workoutSessionProgramId = urlParams.get('programId')
const workoutSessionDate = urlParams.get('date')

if (!workoutSessionProgramId || !workoutSessionDate) {
  window.location.href = '/'
  throw new Error('Workout session programId and date are required')
}

const appHeaderTitle = document.querySelector('.app-header-title') as HTMLHeadingElement
const gymtimeForm = document.querySelector('#gymtime-form') as HTMLFormElement
const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement

let existingWorkoutSession = await workoutSessionsStore.getWorkoutSession(workoutSessionDate)
const program = await programsStore.getProgram(workoutSessionProgramId)

if (!program) {
  window.location.href = '/'
  throw new Error('Program not found')
}

appHeaderTitle.textContent = program.name

const initializeWorkoutSessionForm = () => {
  const programIdInput = gymtimeForm.querySelector('input[name="programId"]') as HTMLInputElement
  const dateInput = gymtimeForm.querySelector('input[name="date"]') as HTMLInputElement
  const locationInput = gymtimeForm.querySelector('input[name="location"]') as HTMLInputElement
  const notesInput = gymtimeForm.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  const submitButton = gymtimeForm.querySelector('button[type="submit"]') as HTMLButtonElement

  programIdInput.value = program.id
  dateInput.value = existingWorkoutSession?.date || new Date().toISOString().split('T')[0]
  notesInput.value = existingWorkoutSession?.notes || ''
  if (existingWorkoutSession) {
    locationInput.value = existingWorkoutSession.location
  } else {
    setCityFromGeolocation(locationInput)
  }

  if (existingWorkoutSession?.status === 'completed') {
    submitButton.textContent = 'Save'
  } else if (existingWorkoutSession?.status === 'incomplete') {
    submitButton.textContent = 'Save & continue workout'
  }
}

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
      const latestWorkoutSessionOfProgram = await workoutSessionsStore.getLatestWorkoutSessionOfProgram(program.id)
      latestSet = latestWorkoutSessionOfProgram?.exercises
        .find(({ exerciseId }) => exerciseId === programExercise.id)
        ?.sets.at(-1) ?? { reps: programExercise.reps, weight: 0 }
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
        existingWorkoutSession.exercises.find(({ exerciseId: id }) => id === programExercise.id)?.sets.length ?? 0

      completedSets.appendChild(renderCompletedSetItem({ set: completedSet, index }))

      if (index + 1 === programExercise.sets) {
        existingWorkoutSession = await workoutSessionsStore.updateWorkoutSession({
          ...existingWorkoutSession,
          status: 'completed'
        })

        exerciseDetails.removeAttribute('open')
        exerciseItemDiv.classList.add('card-success')
        nextSetDiv.remove()
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

initializeWorkoutSessionForm()
renderProgramExercises()

gymtimeForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const formData = new FormData(gymtimeForm)
  const programId = formData.get('programId') as string
  const date = formData.get('date') as string
  const location = formData.get('location') as string
  const notes = formData.get('notes') as string
  console.log(programId, date, location, notes)

  if (existingWorkoutSession) {
    existingWorkoutSession = await workoutSessionsStore.updateWorkoutSession({
      ...existingWorkoutSession,
      location,
      notes
    })
  } else {
    existingWorkoutSession = await workoutSessionsStore.createWorkoutSession({
      programId,
      date,
      location,
      status: 'incomplete',
      exercises: [],
      notes
    })
  }

  workoutDetails.removeAttribute('open')
})
