import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'
import { breakTimer } from '../../features/breakTimer'
import { onWorkoutPage } from '../../features/startButton'
import ExercisePicker from '../ExercisePicker'
import { animateDetails } from './animateDetails'
import EditSetDialog from './EditSetDialog'
import ExerciseCardList from './ExerciseCardList'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'
import { OpenSession, StartDeclined } from './openSession'
import { parseUrlParams } from './parseUrlParams'
import PasskeyOfferCard from './PasskeyOfferCard'
import WatchReminderSheet from './WatchReminderSheet'
import WorkoutSessionForm from './WorkoutSessionForm'

class GymtimePage {
  private pageContent = document.querySelector('.app-page-content') as HTMLDivElement
  private deleteWorkoutSessionBtn = document.querySelector('#delete-workout-session-btn') as HTMLButtonElement
  private workoutDetails = document.querySelector('#workout-details') as HTMLDetailsElement
  private saveToProgramCard = document.querySelector('#save-to-program-card') as HTMLDivElement
  private addExerciseBtn = document.querySelector('#add-exercise-btn') as HTMLButtonElement
  private program!: Program
  private openSession: OpenSession
  private picker = new ExercisePicker()
  private editSetDialog: EditSetDialog
  private historyChart: ExerciseHistoryChart
  private lastSetDialog: LastSetDialog
  private watchReminder = new WatchReminderSheet()
  private signal: AbortSignal

  // The page shows one workout until signal aborts, as when the next page replaces it.
  constructor(signal: AbortSignal) {
    this.signal = signal
    this.openSession = new OpenSession(new PasskeyOfferCard(signal))
    this.addExerciseBtn.addEventListener('click', () => this.addExercises())
    this.editSetDialog = new EditSetDialog(this.openSession)
    this.historyChart = new ExerciseHistoryChart(signal)
    this.lastSetDialog = new LastSetDialog()
    breakTimer().onWorkoutPage((exercise) => void this.historyChart.openDialog(exercise), signal)
  }

  private async init() {
    const { program, workoutSession } = await parseUrlParams()
    this.program = program

    setTextContent('.app-header-title', program.name)

    const workoutForm = this.workoutDetails.querySelector('form') as HTMLFormElement
    animateDetails(this.workoutDetails, workoutForm)

    // Until the first change starts the workout, the cards show the program's exercises, and the summary line shows
    // the day and gym the start will store.
    const form = new WorkoutSessionForm(this.openSession, program.id)
    const cardList = new ExerciseCardList(
      {
        session: this.openSession,
        editSet: this.editSetDialog,
        picker: this.picker,
        history: this.historyChart,
        lastSet: this.lastSetDialog
      },
      program.exercises,
      () => form.planned()
    )
    // The workout starts once the lifter has heard to start it on their watch too.
    this.openSession.startWith({
      start: async () => {
        if (!(await this.watchReminder.confirmStart(form.planned().date))) throw new StartDeclined()
        return form.start()
      },
      exerciseIds: () => this.program.exercises
    })
    this.openSession.subscribe((session) => {
      // A started workout opens again from its own link, on a reload or from the back/forward cache.
      if (session && new URLSearchParams(window.location.search).get('id') !== session.id) {
        window.history.replaceState({}, '', `?id=${session.id}`)
      }
      this.updateDeleteBtnVisibility()
      this.updateSaveToProgramBtnVisibility()
    })

    await form.init(workoutSession, {
      onPlanChanged: () => {
        void cardList.replan()
      }
    })

    this.deleteWorkoutSessionBtn.addEventListener('click', async () => {
      const session = this.openSession.current
      if (!session) return
      if (!confirm('Are you sure you want to delete this workout session?')) return

      await workoutSessionsStore.remove(session.id)
      // The break belongs to the workout, so it goes with it, instead of offering "Back to workout" on the next page.
      breakTimer().closeFor(session.id)
      Toasts.show({ message: 'Workout session deleted' })
      window.location.href = `/workouts/`
    })

    this.saveToProgramCard.addEventListener('click', async () => {
      const session = this.openSession.current
      if (!session) return

      const sessionExerciseIds = session.exercises.map((e) => e.exerciseId)

      this.program.exercises = sessionExerciseIds
      await programsStore.update(this.program)

      cardList.setProgramExerciseIds(sessionExerciseIds)

      Toasts.show({ message: 'Saved to program' })
      this.updateSaveToProgramBtnVisibility()
    })

    // The first draw: the cards, and the buttons that depend on a session.
    await this.openSession.show(workoutSession)

    // The nav's Start button starts the workout shown before it starts, and finishes it early once it runs.
    onWorkoutPage(
      {
        current: () => this.openSession.current,
        start: () => this.startWorkout(),
        finish: () => this.finishWorkout()
      },
      this.signal
    )
    // Start on another page brings the lifter here to start the suggested workout at once.
    const params = new URLSearchParams(window.location.search)
    if (params.has('start') && !workoutSession) {
      params.delete('start')
      window.history.replaceState({}, '', `?${params}`)
      void this.startWorkout()
    }
  }

  // Starts the workout with no change of its own: the watch reminder asks first, as before any first change.
  private async startWorkout() {
    try {
      await this.openSession.apply(async (session) => session)
    } catch {
      // apply said what failed.
    }
  }

  // Finishes the workout early, which completes it, and celebrates as a workout done set by set does.
  private async finishWorkout() {
    try {
      await this.openSession.apply((session) => workoutSessionsStore.finish(session))
    } catch {
      // apply said what failed.
    }
  }

  // Adds the exercises ticked to the end of the workout, in the order ticked. The first one starts the workout when
  // none is open, and a change that fails to store stops the rest.
  private addExercises() {
    const taken = new Set(this.openSession.exerciseIds())
    this.picker.add({ title: 'Add exercises', taken, takenNote: 'In workout' }, async (exercises) => {
      try {
        for (const exercise of exercises) {
          await this.openSession.apply((session) => workoutSessionsStore.addExercise(session, exercise))
        }
      } catch {
        // apply said what failed.
      }
    })
  }

  // Shows "Save to program" while the workout's exercises differ from the program's.
  private updateSaveToProgramBtnVisibility() {
    const sessionExerciseIds = this.openSession.current?.exercises.map((e) => e.exerciseId)
    const programExerciseIds = this.program.exercises
    const isDifferent =
      sessionExerciseIds !== undefined &&
      (sessionExerciseIds.length !== programExerciseIds.length ||
        sessionExerciseIds.some((id, index) => id !== programExerciseIds[index]))

    this.saveToProgramCard.classList.toggle('hidden', !isDifferent)
  }

  private updateDeleteBtnVisibility() {
    this.deleteWorkoutSessionBtn.classList.toggle('hidden', !this.openSession.current)
  }

  private showError(message: string) {
    // There is no workout to delete.
    this.deleteWorkoutSessionBtn.classList.add('hidden')
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

  // Shows the workout the address names, or why it can't.
  async start() {
    try {
      await this.init()
    } catch (error) {
      console.error('Failed to initialize gymtime page:', error)
      this.showError('Could not load workout. The program or session may no longer exist.')
    }
  }
}

export default GymtimePage
