import { getSimpleDate } from '../../dateUtils'
import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import { placeholderSnapshot, snapshotFromExercise, workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import Toasts from '../../features/toasts'
import { openSession } from './openSession'

class WorkoutSessionForm {
  private static form = document.querySelector('#gymtime-form') as HTMLFormElement
  private static dateInput = this.form.querySelector('input[name="date"]') as HTMLInputElement
  private static locationInput = this.form.querySelector('input[name="location"]') as HTMLInputElement
  private static clearGymBtn = this.form.querySelector('#clear-gym-btn') as HTMLButtonElement
  private static gymOptions = this.form.querySelector('#gym-options') as HTMLDataListElement
  private static notesInput = this.form.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private static submitButton = this.form.querySelector('button[type="submit"]') as HTMLButtonElement
  private static programId: Program['id']
  private static onSessionSaved: () => void | Promise<void>

  static async init(programId: Program['id'], onSessionSaved: () => void | Promise<void>) {
    this.programId = programId
    this.onSessionSaved = onSessionSaved

    const session = openSession.current

    const today = getSimpleDate(new Date())

    this.dateInput.value = session?.date || today
    this.dateInput.max = today
    this.notesInput.value = session?.notes || ''

    if (session) {
      this.locationInput.value = session.location
    } else {
      const latestSaved = await workoutSessionsStore.getLatestSaved()
      if (latestSaved?.location) {
        this.locationInput.value = latestSaved.location
      }
    }

    this.showGymOptions((await workoutSessionsStore.getGyms()).map(({ name }) => name))

    // Emptying the field shows every suggestion, and keeping the focus there keeps the keyboard and the
    // suggestions above it open.
    this.clearGymBtn.addEventListener('click', () => {
      this.locationInput.value = ''
      this.locationInput.focus()
    })

    if (session?.status === 'completed') {
      this.submitButton.textContent = 'Save'
    } else if (session?.status === 'incomplete') {
      this.submitButton.textContent = 'Save & continue workout'
    }

    this.form.addEventListener('submit', (e) => this.onSubmit(e))
    this.submitButton.disabled = false
  }

  // The field's suggestions: a <datalist>, which Chrome shows as a dropdown and Safari above the keyboard.
  private static showGymOptions(names: Array<string>) {
    this.gymOptions.replaceChildren(...names.map((name) => new Option(name)))
  }

  private static async onSubmit(event: Event) {
    event.preventDefault()
    const formData = new FormData(this.form)
    const date = formData.get('date') as string
    const location = formData.get('location') as string
    const notes = formData.get('notes') as string

    if (openSession.current) {
      await openSession.apply((session) => workoutSessionsStore.update(session, { date, location, notes }))
    } else {
      const program = await programsStore.getById(this.programId)
      if (!program) throw new Error('Program not found')

      const exercises = await Promise.all(
        program.exercises.map(async (exerciseId) => {
          const exercise = exercisesStore.find(exerciseId) ?? (await exercisesStore.getById(exerciseId))
          return exercise ? snapshotFromExercise(exercise) : placeholderSnapshot(exerciseId)
        })
      )

      openSession.show(
        await workoutSessionsStore.create({ programId: this.programId, date, location, exercises, notes })
      )
    }

    await this.onSessionSaved()
    Toasts.show({ message: 'Workout session saved.' })
  }
}

export default WorkoutSessionForm
