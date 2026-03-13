import { db } from '../../db'
import { exportIndexedDbToJson } from '../../db/export'
import type { Exercise } from '../../db/stores/exercisesStore'
import {
  workoutSessionsStore,
  type ExerciseSetExecution,
  type WorkoutSession
} from '../../db/stores/workoutSessionsStore'
import { throwConfetti } from '../../features/confetti'
import { nodeFromTemplate, setTextContent } from '../../utils'
import type BreakTimerDialog from './BreakTimerDialog'
import type EditSetDialog from './EditSetDialog'

export interface ExerciseCardContext {
  exercise: Exercise
  programId: string
  programExerciseIds: string[]
  getSession: () => WorkoutSession | undefined
  setSession: (session: WorkoutSession) => void
  editSetDialog: EditSetDialog
  breakTimerDialog: BreakTimerDialog
  isWorkoutComplete: () => boolean
  onExerciseDeleted: () => void
}

export async function renderExerciseCard(ctx: ExerciseCardContext): Promise<DocumentFragment> {
  const {
    exercise,
    programId,
    programExerciseIds,
    getSession,
    setSession,
    editSetDialog,
    breakTimerDialog,
    isWorkoutComplete,
    onExerciseDeleted
  } = ctx

  const renderSetItem = ({
    set,
    index,
    isCompleted = true
  }: {
    set: ExerciseSetExecution
    index: number
    isCompleted?: boolean
  }) => {
    const template = nodeFromTemplate('#completed-set-item-template')
    const div = template.querySelector('div') as HTMLDivElement
    const setNumber = (index + 1).toString()

    setTextContent('.set-reps', (set.reps || '-').toString(), template)
    setTextContent('.set-weight', (set.weight || '-').toString(), template)
    setTextContent('.set-number', setNumber, template)

    div.classList.add(isCompleted ? 'isCompleted' : 'isPending')
    div.setAttribute('data-set-number', setNumber)
    div.setAttribute('data-reps', set.reps.toString())
    div.setAttribute('data-weight', set.weight.toString())

    div.addEventListener('click', () => {
      if (!div.classList.contains('isCompleted')) return

      const session = getSession()
      if (!session) throw new Error('No existing workout session found')

      editSetDialog.openDialog({
        set: {
          reps: parseFloat(div.dataset.reps!),
          weight: parseFloat(div.dataset.weight!)
        },
        workoutSession: session,
        exerciseId: exercise.id,
        index
      })
    })

    return template
  }

  const template = nodeFromTemplate('#workout-exercise-item-template')
  const exerciseDetails = template.querySelector('.exercise-details') as HTMLDetailsElement
  const completedSets = exerciseDetails.querySelector('.completed-sets') as HTMLDivElement
  const cardDiv = template.querySelector('div') as HTMLDivElement
  const nextSetDiv = template.querySelector('.next-set') as HTMLDivElement
  const submitButton = nextSetDiv.querySelector('button[type="submit"]') as HTMLButtonElement
  const deleteBtn = template.querySelector('.delete-workout-session-exercise-btn') as HTMLButtonElement

  cardDiv.setAttribute('data-exercise-id', exercise.id)

  exerciseDetails.addEventListener('toggle', () => {
    deleteBtn.classList.toggle('hidden', !exerciseDetails.open)
  })

  deleteBtn.addEventListener('click', async () => {
    const session = getSession()
    if (!session) {
      alert('Start a workout session first')
      return
    }

    if (!confirm('Are you sure you want to delete this exercise from the workout session?')) return

    const updated = await workoutSessionsStore.deleteExerciseFromWorkoutSession({
      workoutSession: session,
      exerciseId: exercise.id
    })
    setSession(updated)
    onExerciseDeleted()
  })

  exerciseDetails.addEventListener('click', () => {
    if (!exerciseDetails.open) {
      document.querySelectorAll<HTMLDetailsElement>('.exercise-details').forEach((details) => {
        if (details !== exerciseDetails) details.removeAttribute('open')
      })
    }
  })

  setTextContent('.exercise-name', exercise.name, template)
  setTextContent('.exercise-muscle', exercise.muscle, template)

  const session = getSession()
  const existingExercise = session?.exercises.find(({ exerciseId }) => exerciseId === exercise.id)

  if (existingExercise) {
    if (existingExercise.sets.length === exercise.sets) {
      cardDiv.classList.add('card-success')
    }

    for (const [index, set] of existingExercise.sets.entries()) {
      completedSets.appendChild(renderSetItem({ set, index }))
    }

    for (let i = existingExercise.sets.length; i < exercise.sets; i++) {
      completedSets.appendChild(renderSetItem({ set: { reps: 0, weight: 0 }, index: i, isCompleted: false }))
    }
  }

  if (!session) {
    submitButton.classList.add('hidden')
  } else {
    submitButton.classList.remove('hidden')
  }

  if (!existingExercise || existingExercise.sets.length < exercise.sets) {
    const nextSetForm = template.querySelector('.next-set-form') as HTMLFormElement
    const nextSetRepsInput = nextSetForm.querySelector('input[name="set-reps"]') as HTMLInputElement
    const nextSetWeightInput = nextSetForm.querySelector('input[name="set-weight"]') as HTMLInputElement

    let latestSet = session?.exercises.find(({ exerciseId }) => exerciseId === exercise.id)?.sets.at(-1)

    if (!latestSet) {
      const latestSession = await workoutSessionsStore.getLatestCompletedWorkoutSessionOfProgram(programId)
      latestSet = latestSession?.exercises
        .find(({ exerciseId }) => exerciseId === exercise.id)
        ?.sets.at(-1)

      latestSet = latestSet ?? { reps: exercise.reps, weight: 0 }
    }

    nextSetRepsInput.value = latestSet.reps.toString()
    nextSetWeightInput.value = latestSet.weight.toString()

    const currentIndex = programExerciseIds.findIndex((id) => id === exercise.id)
    const nextExerciseId = currentIndex >= 0 ? programExerciseIds[currentIndex + 1] : undefined
    const nextExercise = nextExerciseId ? await db.exercises.getById(nextExerciseId) : undefined

    nextSetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const formData = new FormData(nextSetForm)
      const reps = formData.get('set-reps') as string
      const weight = formData.get('set-weight') as string

      if (weight === '0' || reps === '0') {
        if (!confirm(`Are you sure you want to submit a set with 0 ${weight === '0' ? 'weight' : 'reps'}?`)) return
      }

      const currentSession = getSession()
      if (!currentSession) throw new Error('No existing workout session found')

      const completedSet = { reps: parseFloat(reps), weight: parseFloat(weight) }

      const updated = await workoutSessionsStore.addExerciseExecutionSetToWorkoutSession({
        workoutSession: currentSession,
        exerciseId: exercise.id,
        exerciseExecutionSet: completedSet
      })
      setSession(updated)

      const setIndex =
        (updated.exercises.find(({ exerciseId: id }) => id === exercise.id)?.sets.length ?? 1) - 1

      const pendingSetItem = completedSets.querySelector(`[data-set-number="${setIndex + 1}"]`) as HTMLDivElement
      pendingSetItem.classList.remove('isPending')
      pendingSetItem.classList.add('isCompleted')
      setTextContent('.set-reps', completedSet.reps.toString(), pendingSetItem)
      setTextContent('.set-weight', completedSet.weight.toString(), pendingSetItem)
      pendingSetItem.setAttribute('data-reps', completedSet.reps.toString())
      pendingSetItem.setAttribute('data-weight', completedSet.weight.toString())

      if (setIndex + 1 === exercise.sets) {
        exerciseDetails.removeAttribute('open')
        cardDiv.classList.add('card-success')
        nextSetDiv.remove()
      }

      if (isWorkoutComplete()) {
        const completed = await workoutSessionsStore.updateWorkoutSession({ ...updated, status: 'completed' })
        setSession(completed)
        throwConfetti('Workout done!')
        exportIndexedDbToJson()
      } else {
        const isExerciseCompleted = exercise.sets === setIndex + 1

        if (isExerciseCompleted) {
          navigator.vibrate([50, 30, 50, 30, 70])
          breakTimerDialog.closeDialog()
          throwConfetti('Exercise done!')
        } else {
          breakTimerDialog.startTimer({
            minutes: 2,
            seconds: 30,
            setsDone: setIndex + 1,
            setsTotal: exercise.sets,
            nextExercise: nextExercise?.name
          })
        }
      }
    })
  } else {
    nextSetDiv.remove()
  }

  return template
}
