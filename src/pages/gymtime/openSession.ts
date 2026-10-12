import { getCloudBackupConfig } from '../../db/cloudBackup'
import { exportIndexedDbToJson } from '../../db/export'
import { hasExercise } from '../../db/stores/workoutSessionsStore'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { WorkoutSession } from '../../db/types'
import { throwConfetti } from '../../features/confetti'
import Toasts from '../../features/toasts'
import { getBreakTimeSeconds } from '../../settings'
import BreakTimerDialog from './BreakTimerDialog'
import PasskeyOfferCard from './PasskeyOfferCard'
import { outcomeOf, type Outcome } from './outcome'

// Shows the open session on screen, and resolves once the screen shows it or a later one.
type View = (session: WorkoutSession | undefined) => void | Promise<void>

// The workout this gymtime page shows, or undefined until the form starts one.
let open: WorkoutSession | undefined
const views = new Set<View>()

// Writes and the views showing their result, still running. The region is aria-busy while any is.
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

  // While a change is on its way to the screen, region carries aria-busy, so assistive technology waits
  // for it, and so can the specs.
  busyOn(region: HTMLElement): void {
    busyRegion = region
    if (running > 0) region.setAttribute('aria-busy', 'true')
  },

  // Shows the session the page loaded or started.
  async show(session: WorkoutSession | undefined): Promise<void> {
    await whileBusy(() => showNow(session))
  },

  // Runs a workoutSessionsStore write on the open session and resolves once the screen shows the session it stored
  // and the lifter has heard what the change means. Nothing changes on screen before the write lands. loggedFor names
  // the exercise when the write logs a set from its card, the only change that ends an exercise or starts a break.
  async apply(
    write: (session: WorkoutSession) => Promise<WorkoutSession>,
    { loggedFor }: { loggedFor?: Exercise['id'] } = {}
  ): Promise<WorkoutSession> {
    const session = open
    if (!session) throw new Error('No workout session is open')
    const next = await whileBusy(async () => {
      const next = await write(session)
      await showNow(next)
      return next
    })
    await actOn(outcomeOf(session, next, loggedFor, getBreakTimeSeconds()))
    return next
  }
}

// Tells the user when the exercise is already in the open session, which holds each exercise once.
export const alertIfInSession = (exerciseId: Exercise['id']): boolean => {
  if (!open || !hasExercise(open, exerciseId)) return false
  alert('This exercise is already in your session.')
  return true
}

// A finished workout or exercise ends the break, and a finished workout is celebrated every time: an exercise or set
// added afterwards makes it incomplete again. Without cloud backup, a finished workout also downloads a JSON export,
// the only copy outside this browser. Without a passkey backup, it also offers one.
// Vibration patterns, in ms of buzz and pause: a short triple for an exercise, and a "ta-da-da-daaa" fanfare for the
// workout. Safari has no Vibration API, so both are silent there.
const EXERCISE_DONE_VIBRATION = [50, 30, 50, 30, 70]
const WORKOUT_DONE_VIBRATION = [60, 40, 60, 40, 60, 80, 400]

const actOn = async (outcome: Outcome): Promise<void> => {
  switch (outcome.kind) {
    case 'workout-done':
      navigator.vibrate?.(WORKOUT_DONE_VIBRATION)
      BreakTimerDialog.closeDialog()
      throwConfetti('Workout done!')
      PasskeyOfferCard.offer()
      if (getCloudBackupConfig()) return
      try {
        await exportIndexedDbToJson()
      } catch (error) {
        console.error('Error exporting database:', error)
        Toasts.show({ message: 'Could not download the JSON export.', type: 'error' })
      }
      return
    case 'exercise-done':
      navigator.vibrate?.(EXERCISE_DONE_VIBRATION)
      BreakTimerDialog.closeDialog()
      throwConfetti('Exercise done!')
      return
    case 'rest':
      BreakTimerDialog.start(outcome)
      return
    case 'none':
      return
  }
}
