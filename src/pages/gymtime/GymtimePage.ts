import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import { onPageNotice } from '../../sync/pageChannel'
import { canonical } from '../../sync/rows'
import { setTextContent } from '../../utils'
import AddExerciseDialog from './AddExerciseDialog'
import { animateDetails, type AnimateDetailsHandle } from './animateDetails'
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
  private static workoutDetailsAnimation: AnimateDetailsHandle | null = null

  static async init() {
    const { program, workoutSession } = await parseUrlParams()
    this.program = program

    openSession.show(workoutSession)
    window.addEventListener('jimbro:open-session-pulled', () => void this.refreshSession())
    // Other tabs share this database, so their writes and pulls never reach this page as a changed pull.
    onPageNotice(() => void this.refreshSession())
    setTextContent('.app-header-title', program.name)

    const workoutForm = this.workoutDetails.querySelector('form') as HTMLFormElement
    this.workoutDetailsAnimation = animateDetails(this.workoutDetails, workoutForm)

    if (openSession.current) {
      this.workoutDetailsAnimation.close()
    }

    ExerciseCardList.init(program.exercises)
    AddExerciseDialog.init(async (exercise) => {
      if (!openSession.current || alertIfInSession(exercise.id)) return

      await openSession.apply((session) => workoutSessionsStore.addExercise(session, exercise))
      await ExerciseCardList.render()
    })

    await WorkoutSessionForm.init(program.id, async () => {
      const session = openSession.current
      if (session) window.history.replaceState({}, '', `?id=${session.id}`)
      await ExerciseCardList.render()
      this.updateDeleteBtnVisibility()
      this.workoutDetailsAnimation?.close()
    })

    this.deleteWorkoutSessionBtn.addEventListener('click', async () => {
      const session = openSession.current
      if (!session) return
      if (!confirm('Are you sure you want to delete this workout session?')) return

      await workoutSessionsStore.remove(session.id)
      openSession.show(undefined)
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

    openSession.subscribe(() => {
      this.updateSaveToProgramBtnVisibility()
    })

    await ExerciseCardList.render()
    this.updateDeleteBtnVisibility()
    this.updateSaveToProgramBtnVisibility()
  }

  private static async refreshSession(): Promise<void> {
    const sessionId = new URLSearchParams(window.location.search).get('id')
    if (!sessionId) return
    const shown = canonical(openSession.current)
    const session = await workoutSessionsStore.getById(sessionId)
    // A change this page stored while the read ran, such as a logged set, may be missing from what it read,
    // so it reads again.
    if (canonical(openSession.current) !== shown) return this.refreshSession()
    if (canonical(session) === shown) return
    openSession.show(session)
    await ExerciseCardList.render()
    this.updateDeleteBtnVisibility()
    this.updateSaveToProgramBtnVisibility()
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
