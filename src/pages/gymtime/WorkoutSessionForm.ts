import EventEmitter from '../../db/eventEmitter'
import type { Program } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'
import { setCityFromGeolocation } from './geolocation'

interface WorkoutSessionFormProps {
  programId: Program['id']
  workoutSessionDate: WorkoutSession['date']
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
  private workoutSessionDate: string
  private programId: Program['id']

  constructor({ programId, workoutSessionDate }: WorkoutSessionFormProps) {
    super()
    this.programId = programId
    this.workoutSessionDate = workoutSessionDate
    this.init()
  }

  async init() {
    const existingWorkoutSession = await workoutSessionsStore.getWorkoutSession(this.workoutSessionDate)

    this.programIdInput.value = this.programId
    this.dateInput.value = existingWorkoutSession?.date || new Date().toISOString().split('T')[0]
    this.notesInput.value = existingWorkoutSession?.notes || ''

    if (existingWorkoutSession) {
      this.locationInput.value = existingWorkoutSession.location
    } else {
      setCityFromGeolocation(this.locationInput)
    }

    if (existingWorkoutSession?.status === 'completed') {
      this.submitButton.textContent = 'Save'
    } else if (existingWorkoutSession?.status === 'incomplete') {
      this.submitButton.textContent = 'Save & continue workout'
    }

    this.gymtimeForm.addEventListener('submit', this.onSubmit.bind(this))
  }

  private async onSubmit(event: Event) {
    event.preventDefault()
    const formData = new FormData(this.gymtimeForm)
    const programId = formData.get('programId') as string
    const date = formData.get('date') as string
    const location = formData.get('location') as string
    const notes = formData.get('notes') as string

    const existingWorkoutSession = (await workoutSessionsStore.getWorkoutSession(this.workoutSessionDate)) ?? {
      programId,
      date,
      location,
      status: 'incomplete',
      exercises: [],
      notes
    }

    const updatedWorkoutSession = await workoutSessionsStore.updateWorkoutSession({
      ...existingWorkoutSession,
      location,
      notes
    })

    this.emit('workout-session-updated', { workoutSession: updatedWorkoutSession })
  }
}

export default WorkoutSessionForm
