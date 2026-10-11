import { getCloudBackupConfig } from '../../db/cloudBackup'
import { exportIndexedDbToJson } from '../../db/export'
import { hasExercise, workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { WorkoutSession } from '../../db/types'
import { throwConfetti } from '../../features/confetti'
import Toasts from '../../features/toasts'
import { canonical } from '../../sync/rows'

// Shows the open session on screen, and resolves once the screen shows it or a later one.
type View = (session: WorkoutSession | undefined) => void | Promise<void>

// The workout this gymtime page shows, or undefined until the form starts one.
let open: WorkoutSession | undefined
const views = new Set<View>()

// Rereads, writes and the views showing their result, still running. The region is aria-busy while any is.
let running = 0
let busyRegion: HTMLElement | undefined

const whileBusy = async <T>(work: () => Promise<T>): Promise<T> => {
  if (running++ === 0) busyRegion?.setAttribute('aria-busy', 'true')
  try {
    return await work()
  } finally {
    if (--running === 0) busyRegion?.removeAttribute('aria-busy')
  }
}

const showNow = async (session: WorkoutSession | undefined): Promise<void> => {
  open = session
  await Promise.all([...views].map(async (view) => view(session)))
}

// Every change to the open session, whatever caused it, reaches the screen the same way: it is stored here, then
// every view shows it.
export const openSession = {
  get current(): WorkoutSession | undefined {
    return open
  },

  subscribe(view: View): () => void {
    views.add(view)
    return () => views.delete(view)
  },

  // While a reread or a change is on its way to the screen, region carries aria-busy, so assistive technology waits
  // for it, and so can the specs.
  busyOn(region: HTMLElement): void {
    busyRegion = region
    if (running > 0) region.setAttribute('aria-busy', 'true')
  },

  // Shows the session the page loaded or started.
  async show(session: WorkoutSession | undefined): Promise<void> {
    await whileBusy(() => showNow(session))
  },

  // Runs a workoutSessionsStore write on the open session and resolves once the screen shows the session it stored.
  // Nothing changes on screen before the write lands. A write that takes the workout from incomplete to completed
  // celebrates it, every time: an exercise or set added afterwards makes it incomplete again.
  async apply(write: (session: WorkoutSession) => Promise<WorkoutSession>): Promise<WorkoutSession> {
    const session = open
    if (!session) throw new Error('No workout session is open')
    const next = await whileBusy(async () => {
      const next = await write(session)
      await showNow(next)
      return next
    })
    if (session.status === 'incomplete' && next.status === 'completed') await celebrateWorkout()
    return next
  },

  // Reads the open session again, after a pull or another tab may have changed it, and shows it when it changed.
  async reread(): Promise<void> {
    await whileBusy(async () => {
      for (;;) {
        if (!open) return
        const shown = canonical(open)
        const session = await workoutSessionsStore.getById(open.id)
        // A change this page stored while the read ran, such as a logged set, may be missing from what it read,
        // so it reads again.
        if (canonical(open) !== shown) continue
        if (canonical(session) !== shown) await showNow(session)
        return
      }
    })
  }
}

// Tells the user when the exercise is already in the open session, which holds each exercise once.
export const alertIfInSession = (exerciseId: Exercise['id']): boolean => {
  if (!open || !hasExercise(open, exerciseId)) return false
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
