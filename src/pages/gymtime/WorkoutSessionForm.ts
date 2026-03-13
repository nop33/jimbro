import { db } from '../../db'
import type { Program } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'
import EventEmitter from '../../eventEmitter'
import Toasts from '../../features/toasts'
import { setCityFromGeolocation } from './geolocation'

interface WorkoutSessionFormProps {
  programId: Program['id']
  existingSession?: WorkoutSession
}

type WorkoutSessionFormEventMap = {
  'workout-session-updated': { workoutSession: WorkoutSession }
}

class WorkoutSessionForm extends EventEmitter<WorkoutSessionFormEventMap> {
  private gymtimeForm = document.querySelector('#gymtime-form') as HTMLFormElement
  private programIdInput = this.gymtimeForm.querySelector('input[name="programId"]') as HTMLInputElement
  private dateInput = this.gymtimeForm.querySelector('input[name="date"]') as HTMLInputElement
  private locationInput = this.gymtimeForm.querySelector('input[name="location"]') as HTMLInputElement
  private notesInput = this.gymtimeForm.querySelector('textarea[name="notes"]') as HTMLTextAreaElement
  private submitButton = this.gymtimeForm.querySelector('button[type="submit"]') as HTMLButtonElement
  private programId: Program['id']
  private existingSession?: WorkoutSession

  constructor({ programId, existingSession }: WorkoutSessionFormProps) {
    super()
    this.programId = programId
    this.existingSession = existingSession
    this.init()
  }

  private init() {
    this.programIdInput.value = this.programId
    this.dateInput.value = this.existingSession?.date || new Date().toISOString().split('T')[0]
    this.notesInput.value = this.existingSession?.notes || ''

    if (this.existingSession) {
      this.locationInput.value = this.existingSession.location
    } else {
      setCityFromGeolocation(this.locationInput)
    }

    if (this.existingSession?.status === 'completed') {
      this.submitButton.textContent = 'Save'
    } else if (this.existingSession?.status === 'incomplete') {
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

    let workoutSession: WorkoutSession

    if (this.existingSession) {
      workoutSession = await workoutSessionsStore.updateWorkoutSession({
        ...this.existingSession,
        date,
        location,
        notes
      })
    } else {
      const program = await db.programs.getById(this.programId)
      if (!program) {
        throw new Error('Program not found')
      }

      workoutSession = await workoutSessionsStore.createWorkoutSession({
        programId: this.programId,
        date,
        location,
        status: 'incomplete',
        exercises: program.exercises.map((exerciseId) => ({ exerciseId, sets: [] })),
        notes
      })
    }

    this.existingSession = workoutSession
    this.emit('workout-session-updated', { workoutSession })
    Toasts.show({ message: 'Workout session saved.' })
  }
}

export default WorkoutSessionForm
