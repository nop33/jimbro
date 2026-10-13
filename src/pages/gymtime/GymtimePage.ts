import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'
import AddExerciseDialog from './AddExerciseDialog'
import { animateDetails } from './animateDetails'
import ExerciseCardList from './ExerciseCardList'
import { alertIfInSession, openSession } from './openSession'
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

    setTextContent('.app-header-title', program.name)

    const workoutForm = this.workoutDetails.querySelector('form') as HTMLFormElement
    animateDetails(this.workoutDetails, workoutForm)

    // Until the first change starts the workout, the cards show the program's exercises, and the summary line shows
    // the day and gym the start will store.
    ExerciseCardList.init(program.exercises, () => WorkoutSessionForm.planned())
    openSession.startWith({ start: () => WorkoutSessionForm.start(), exerciseIds: () => this.program.exercises })
    openSession.subscribe((session) => {
      // A started workout opens again from its own link, on a reload or from the back/forward cache.
      if (session && new URLSearchParams(window.location.search).get('id') !== session.id) {
        window.history.replaceState({}, '', `?id=${session.id}`)
      }
      this.updateDeleteBtnVisibility()
      this.updateSaveToProgramBtnVisibility()
    })

    AddExerciseDialog.init(async (exercise) => {
      if (alertIfInSession(exercise.id)) return
      await openSession.apply((session) => workoutSessionsStore.addExercise(session, exercise))
    })

    await WorkoutSessionForm.init(program.id, workoutSession, {
      onPlanChanged: () => {
        void ExerciseCardList.replan()
      }
    })

    this.deleteWorkoutSessionBtn.addEventListener('click', async () => {
      const session = openSession.current
      if (!session) return
      if (!confirm('Are you sure you want to delete this workout session?')) return

      await workoutSessionsStore.remove(session.id)
      Toasts.show({ message: 'Workout session deleted' })
      window.location.href = `/workouts/`
    })

    this.saveToProgramCard.addEventListener('click', async () => {
      const session = openSession.current
      if (!session) return

      const sessionExerciseIds = session.exercises.map((e) => e.exerciseId)

      this.program.exercises = sessionExerciseIds
      await programsStore.update(this.program)

      ExerciseCardList.setProgramExerciseIds(sessionExerciseIds)

      Toasts.show({ message: 'Saved to program' })
      this.updateSaveToProgramBtnVisibility()
    })

    // The first draw: the cards, and the buttons that depend on a session.
    await openSession.show(workoutSession)
  }

  private static updateSaveToProgramBtnVisibility() {
    const session = openSession.current
    if (!session) {
      this.saveToProgramCard.classList.add('hidden')
      this.addExerciseCard.classList.replace('mt-2', 'mt-16')
      return
    }

    const sessionExerciseIds = session.exercises.map((e) => e.exerciseId)
    const programExerciseIds = this.program.exercises

    const isDifferent =
      sessionExerciseIds.length !== programExerciseIds.length ||
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
    this.deleteWorkoutSessionBtn.classList.toggle('hidden', !openSession.current)
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
