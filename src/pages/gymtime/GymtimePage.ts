import { db } from '../../db'
import type { Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import AddExerciseDialog from './AddExerciseDialog'
import ExerciseCardList from './ExerciseCardList'
import { parseUrlParams } from './parseUrlParams'
import WorkoutSessionForm from './WorkoutSessionForm'

class GymtimePage {
  private static pageContent = document.querySelector('.app-page-content') as HTMLDivElement
  private static deleteWorkoutSessionBtn = document.querySelector('#delete-workout-session-btn') as HTMLButtonElement
  private static workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement
  private static saveToProgramCard = document.querySelector('#save-to-program-card') as HTMLDivElement
  private static addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  private static program: Program

  static async init() {
    const { program, workoutSession } = await parseUrlParams()
    this.program = program

    GymtimeSessionState.initialize(workoutSession)
    setTextContent('.app-header-title', program.name)

    if (GymtimeSessionState.session) {
      this.workoutDetails.removeAttribute('open')
    }

    ExerciseCardList.init(program.id, program.exercises)
    AddExerciseDialog.init(async (exercise) => {
      if (!GymtimeSessionState.session) return

      if (GymtimeSessionState.hasExercise(exercise.id, { showAlert: true })) {
        return
      }

      await GymtimeSessionState.addExercise(exercise.id)
      ExerciseCardList.render()
    })

    WorkoutSessionForm.init(program.id, () => {
      const session = GymtimeSessionState.session
      if (session) window.history.replaceState({}, '', `?id=${session.id}`)
      ExerciseCardList.render()
      this.updateDeleteBtnVisibility()
      this.workoutDetails.removeAttribute('open')
    })

    this.deleteWorkoutSessionBtn.addEventListener('click', async () => {
      if (!GymtimeSessionState.session) return
      if (!confirm('Are you sure you want to delete this workout session?')) return

      await GymtimeSessionState.delete()
      Toasts.show({ message: 'Workout session deleted' })
      window.location.href = `/workouts/`
    })

    this.saveToProgramCard.addEventListener('click', async () => {
      const session = GymtimeSessionState.session
      if (!session) return

      const sessionExerciseIds = session.exercises.map(e => e.exerciseId)

      this.program.exercises = sessionExerciseIds
      await db.programs.update(this.program)

      ExerciseCardList.setProgramExerciseIds(sessionExerciseIds)

      Toasts.show({ message: 'Saved to program' })
      this.updateSaveToProgramBtnVisibility()
    })

    GymtimeSessionState.subscribe(() => {
      this.updateSaveToProgramBtnVisibility()
    })

    ExerciseCardList.render()
    this.updateDeleteBtnVisibility()
    this.updateSaveToProgramBtnVisibility()
  }

  private static updateSaveToProgramBtnVisibility() {
    const session = GymtimeSessionState.session
    if (!session) {
      this.saveToProgramCard.classList.add('hidden')
      this.addExerciseCard.classList.replace('mt-2', 'mt-16')
      return
    }

    const sessionExerciseIds = session.exercises.map(e => e.exerciseId)
    const programExerciseIds = this.program.exercises

    const isDifferent = sessionExerciseIds.length !== programExerciseIds.length ||
      sessionExerciseIds.some((id, index) => id !== programExerciseIds[index])

    if (isDifferent) {
      this.saveToProgramCard.classList.remove('hidden')
      this.addExerciseCard.classList.replace('mt-16', 'mt-2')
    } else {
      this.saveToProgramCard.classList.add('hidden')
      this.addExerciseCard.classList.replace('mt-2', 'mt-16')
    }
  }

  private static updateDeleteBtnVisibility() {
    this.deleteWorkoutSessionBtn.classList.toggle('hidden', !GymtimeSessionState.session)
  }

  private static showError(message: string) {
    this.pageContent.innerHTML = `
      <div class="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <p class="text-lg text-jim-error"></p>
        <a href="/workouts/" class="btn-primary">Back to workouts</a>
      </div>
    `
    const errorMsg = this.pageContent.querySelector('.text-jim-error') as HTMLParagraphElement
    if (errorMsg) {
      errorMsg.textContent = message
    }
  }

  static start() {
    this.init().catch((error) => {
      console.error('Failed to initialize gymtime page:', error)
      this.showError('Could not load workout. The program or session may no longer exist.')
    })
  }
}

export default GymtimePage
