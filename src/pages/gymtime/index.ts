import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { setCityFromGeolocation } from './geolocation'

const urlParams = new URLSearchParams(window.location.search)
const programId = urlParams.get('programId')
const appHeaderTitle = document.querySelector('.app-header-title') as HTMLHeadingElement
const gymtimeForm = document.querySelector('#gymtime-form') as HTMLFormElement
const exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
const workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement

const workoutSessionDate = new Date().toISOString().split('T')[0]
let workoutSession = await workoutSessionsStore.getWorkoutSession(workoutSessionDate)

if (workoutSession) {
  workoutDetails.removeAttribute('open')
}

if (!programId) {
  window.location.href = '/'
} else {
  const program = await programsStore.getProgram(programId)

  if (program) {
    gymtimeForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const formData = new FormData(gymtimeForm)
      const programId = formData.get('programId') as string
      const date = formData.get('date') as string
      const location = formData.get('location') as string
      const notes = formData.get('notes') as string
      console.log(programId, date, location, notes)

      if (workoutSession) {
        workoutSession = await workoutSessionsStore.updateWorkoutSession({
          ...workoutSession,
          location,
          notes
        })
      } else {
        workoutSession = await workoutSessionsStore.createWorkoutSession({
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

    const latestWorkoutSession = await workoutSessionsStore.getLatestWorkoutSessionOfProgram(program.id)

    appHeaderTitle.textContent = program.name
    const programIdInput = gymtimeForm.querySelector('input[name="programId"]') as HTMLInputElement
    const dateInput = gymtimeForm.querySelector('input[name="date"]') as HTMLInputElement
    const locationInput = gymtimeForm.querySelector('input[name="location"]') as HTMLInputElement
    const notesInput = gymtimeForm.querySelector('textarea[name="notes"]') as HTMLTextAreaElement

    programIdInput.value = program.id
    dateInput.value = workoutSession?.date || new Date().toISOString().split('T')[0]
    notesInput.value = workoutSession?.notes || ''
    if (workoutSession?.location) {
      locationInput.value = workoutSession.location
    } else {
      setCityFromGeolocation(locationInput)
    }

    for (const exerciseId of program.exercises) {
      const exercise = await exercisesStore.getExercise(exerciseId)

      if (exercise) {
        const exerciseItem = nodeFromTemplate('#exercise-item-template')
        const exerciseDetails = exerciseItem.querySelector('.exercise-details') as HTMLDetailsElement
        const completedSets = exerciseDetails.querySelector('.completed-sets') as HTMLDivElement
        const exerciseItemDiv = exerciseItem.querySelector('div') as HTMLDivElement

        const workoutSessionExercise = workoutSession?.exercises.find(
          (exerciseExecution) => exerciseExecution.exerciseId === exercise.id
        )
        if (workoutSessionExercise && workoutSessionExercise.sets.length === exercise.sets) {
          exerciseItemDiv.classList.add('card-success')
        }

        setTextContent('.exercise-name', exercise.name, exerciseItem)
        setTextContent('.exercise-muscle', exercise.muscle, exerciseItem)

        const exerciseExecution = latestWorkoutSession?.exercises.find(
          (exerciseExecution) => exerciseExecution.exerciseId === exercise.id
        )

        const latestSet = exerciseExecution?.sets.at(-1) ?? { reps: exercise.reps, weight: 0 }

        const nextSet = exerciseItem.querySelector('.next-set') as HTMLDivElement
        const nextSetForm = exerciseItem.querySelector('.next-set-form') as HTMLFormElement
        const nextSetRepsInput = nextSetForm.querySelector('input[name="set-reps"]') as HTMLInputElement
        const nextSetWeightInput = nextSetForm.querySelector('input[name="set-weight"]') as HTMLInputElement
        nextSetRepsInput.value = latestSet.reps.toString()
        nextSetWeightInput.value = latestSet.weight.toString()

        exercisesList.appendChild(exerciseItem)

        nextSetForm.addEventListener('submit', async (event) => {
          event.preventDefault()
          const formData = new FormData(nextSetForm)
          const reps = formData.get('set-reps') as string
          const weight = formData.get('set-weight') as string
          console.log(reps, weight)

          if (workoutSession) {
            console.log('workoutSession', workoutSession)

            let workoutSessionExercise = workoutSession.exercises.find(
              (exerciseExecution) => exerciseExecution.exerciseId === exercise.id
            )

            if (workoutSessionExercise) {
              workoutSession = await workoutSessionsStore.updateWorkoutSession({
                ...workoutSession,
                exercises: workoutSession.exercises.map((exerciseExecution) => {
                  if (exerciseExecution.exerciseId === exercise.id) {
                    return {
                      ...exerciseExecution,
                      sets: [...exerciseExecution.sets, { reps: parseFloat(reps), weight: parseFloat(weight) }]
                    }
                  }
                  return exerciseExecution
                })
              })
            } else {
              workoutSession = await workoutSessionsStore.updateWorkoutSession({
                ...workoutSession,
                exercises: [
                  ...workoutSession.exercises,
                  { exerciseId: exercise.id, sets: [{ reps: parseFloat(reps), weight: parseFloat(weight) }] }
                ]
              })
            }

            const completedSetItem = nodeFromTemplate('#completed-set-item-template')
            setTextContent('.set-reps', reps, completedSetItem)
            setTextContent('.set-weight', weight, completedSetItem)
            setTextContent('.set-number', ((workoutSessionExercise?.sets.length ?? 0) + 1).toString(), completedSetItem)

            completedSets.appendChild(completedSetItem)

            workoutSessionExercise = workoutSession.exercises.find(
              (exerciseExecution) => exerciseExecution.exerciseId === exercise.id
            )

            if (workoutSessionExercise?.sets.length === exercise.sets) {
              workoutSession = await workoutSessionsStore.updateWorkoutSession({
                ...workoutSession,
                status: 'completed'
              })
              exerciseDetails.removeAttribute('open')
              nextSet.remove()

              exerciseItemDiv.classList.add('card-success')
            }
          }
        })
      }
    }
  }
}
