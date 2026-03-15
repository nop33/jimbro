import { db } from '../../db'
import type { Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import { setCityFromGeolocation } from './geolocation'

class WorkoutSessionForm {
  private static form = document.querySelector('#gymtime-form') as HTMLFormElement
  private static programIdInput = this.form.querySelector('input[name="programId"]') as HTMLInputElement
  private static dateInput = this.form.querySelector('input[name="date"]') as HTMLInputElement
  private static locationInput = this.form.querySelector('input[name="location"]') as HTMLInputElement
  private static notesInput = this.form.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private static submitButton = this.form.querySelector('button[type="submit"]') as HTMLButtonElement
  private static programId: Program['id']
  private static onSessionSaved: () => void

  static init(programId: Program['id'], onSessionSaved: () => void) {
    this.programId = programId
    this.onSessionSaved = onSessionSaved

    const session = GymtimeSessionState.session

    this.programIdInput.value = this.programId
    this.dateInput.value = session?.date || new Date().toISOString().split('T')[0]
    this.notesInput.value = session?.notes || ''

    if (session) {
      this.locationInput.value = session.location
    } else {
      setCityFromGeolocation(this.locationInput)
    }

    if (session?.status === 'completed') {
      this.submitButton.textContent = 'Save'
    } else if (session?.status === 'incomplete') {
      this.submitButton.textContent = 'Save & continue workout'
    }

    this.form.addEventListener('submit', (e) => this.onSubmit(e))
  }

  private static async onSubmit(event: Event) {
    event.preventDefault()
    const formData = new FormData(this.form)
    const date = formData.get('date') as string
    const location = formData.get('location') as string
    const notes = formData.get('notes') as string

    if (GymtimeSessionState.session) {
      await GymtimeSessionState.update({ date, location, notes })
    } else {
      const program = await db.programs.getById(this.programId)
      if (!program) throw new Error('Program not found')

      // Ensure exercises are unique
      const uniqueExercises = Array.from(new Set(program.exercises))

      await GymtimeSessionState.create({
        programId: this.programId,
        date,
        location,
        status: 'incomplete',
        exercises: uniqueExercises.map((exerciseId) => ({ exerciseId, sets: [] })),
        notes
      })
    }

    this.onSessionSaved()
    Toasts.show({ message: 'Workout session saved.' })
  }
}

export default WorkoutSessionForm
