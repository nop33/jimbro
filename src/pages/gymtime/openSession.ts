import { getCloudBackupConfig } from '../../db/cloudBackup'
import { exportIndexedDbToJson } from '../../db/export'
import ReactiveStore from '../../db/reactiveStore'
import { hasExercise } from '../../db/stores/workoutSessionsStore'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { WorkoutSession } from '../../db/types'
import { throwConfetti } from '../../features/confetti'
import Toasts from '../../features/toasts'

// The workout this gymtime page shows, or undefined until the form starts one.
const open = new ReactiveStore<WorkoutSession | undefined>(undefined)

export const openSession = {
  get current(): WorkoutSession | undefined {
    return open.get()
  },

  subscribe(callback: (session: WorkoutSession | undefined) => void): () => void {
    return open.subscribe(callback)
  },

  show(session: WorkoutSession | undefined): void {
    open.set(session)
  },

  // Runs a workoutSessionsStore write on the open session and shows the session it stored. Nothing changes on
  // screen before the write lands. A write that takes the workout from incomplete to completed celebrates it, every
  // time: an exercise or set added afterwards makes it incomplete again.
  async apply(write: (session: WorkoutSession) => Promise<WorkoutSession>): Promise<WorkoutSession> {
    const session = open.get()
    if (!session) throw new Error('No workout session is open')
    const next = await write(session)
    open.set(next)
    if (session.status === 'incomplete' && next.status === 'completed') await celebrateWorkout()
    return next
  }
}

// Tells the user when the exercise is already in the open session, which holds each exercise once.
export const alertIfInSession = (exerciseId: Exercise['id']): boolean => {
  const session = open.get()
  if (!session || !hasExercise(session, exerciseId)) return false
  alert('This exercise is already in your session.')
  return true
}

// Without cloud backup, a finished workout also downloads a JSON export, the only copy outside this browser.
const celebrateWorkout = async (): Promise<void> => {
  throwConfetti('Workout done!')
  if (getCloudBackupConfig()) return
  try {
    await exportIndexedDbToJson()
  } catch (error) {
    console.error('Error exporting database:', error)
    Toasts.show({ message: 'Could not download the JSON export.', type: 'error' })
  }
}
