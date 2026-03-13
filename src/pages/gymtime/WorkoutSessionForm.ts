import { db } from '../../db'
import type { Program } from '../../db/stores/programsStore'
import EventEmitter from '../../eventEmitter'
import Toasts from '../../features/toasts'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import { setCityFromGeolocation } from './geolocation'

type WorkoutSessionFormEventMap = {
  'session-saved': void
}

class WorkoutSessionForm extends EventEmitter<WorkoutSessionFormEventMap> {
  private gymtimeForm = document.querySelector('#gymtime-form') as HTMLFormElement
  private programIdInput = this.gymtimeForm.querySelector('input[name="programId"]') as HTMLInputElement
  private dateInput = this.gymtimeForm.querySelector('input[name="date"]') as HTMLInputElement
  private locationInput = this.gymtimeForm.querySelector('input[name="location"]') as HTMLInputElement
  private notesInput = this.gymtimeForm.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private submitButton = this.gymtimeForm.querySelector('button[type="submit"]') as HTMLButtonElement
  private programId: Program['id']

  constructor(programId: Program['id']) {
    super()
    this.programId = programId
    this.init()
  }

  private init() {
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

    this.gymtimeForm.addEventListener('submit', this.onSubmit.bind(this))
  }

  private async onSubmit(event: Event) {
    event.preventDefault()
    const formData = new FormData(this.gymtimeForm)
    const date = formData.get('date') as string
    const location = formData.get('location') as string
    const notes = formData.get('notes') as string

    if (GymtimeSessionState.session) {
      await GymtimeSessionState.update({ date, location, notes })
    } else {
      const program = await db.programs.getById(this.programId)
      if (!program) throw new Error('Program not found')

      await GymtimeSessionState.create({
        programId: this.programId,
        date,
        location,
        status: 'incomplete',
        exercises: program.exercises.map((exerciseId) => ({ exerciseId, sets: [] })),
        notes
      })
    }

    this.emit('session-saved')
    Toasts.show({ message: 'Workout session saved.' })
  }
}

export default WorkoutSessionForm
