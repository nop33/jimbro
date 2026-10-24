import { getCloudBackupConfig } from '../../db/cloudBackup'
import { exportIndexedDbToJson } from '../../db/export'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { WorkoutSession } from '../../db/types'
import { popConfetti, stampConfetti } from '../../features/confetti'
import Toasts from '../../features/toasts'
import { getBreakTimeSeconds } from '../../settings'
import BreakTimerDialog from './BreakTimerDialog'
import PasskeyOfferCard from './PasskeyOfferCard'
import { outcomeOf, type Outcome } from './outcome'

// Shows the open session on screen, and resolves once the screen shows it or a later one.
type View = (session: WorkoutSession | undefined) => void | Promise<void>

// Starts the workout the page shows before one exists, and the exercises it will start with.
export interface Starter {
  start: () => Promise<WorkoutSession>
  exerciseIds: () => Array<Exercise['id']>
}

// The workout this gymtime page shows, or undefined until the first change starts one.
let open: WorkoutSession | undefined
const views = new Set<View>()
let starter: Starter | undefined
// The start on its way, so changes made before it lands write to the one workout it creates.
let starting: Promise<WorkoutSession> | undefined

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

  // Forgets the workout, its views and its start, for a gymtime page shown again or left.
  reset(): void {
    open = undefined
    views.clear()
    starter = undefined
    starting = undefined
    running = 0
    busyRegion = undefined
  },

  // Shows the session the page loaded.
  async show(session: WorkoutSession | undefined): Promise<void> {
    await whileBusy(() => showNow(session))
  },

  // How the first change starts the workout when the page opened none.
  startWith(next: Starter): void {
    starter = next
  },

  // The exercises the open session holds, or the ones the start will store.
  exerciseIds(): Array<Exercise['id']> {
    return open ? open.exercises.map(({ exerciseId }) => exerciseId) : (starter?.exerciseIds() ?? [])
  },

  // Runs a workoutSessionsStore write on the open session and resolves once the screen shows the session it stored
  // and the lifter has heard what the change means. Nothing changes on screen before the write lands. With no session
  // open, the write starts the workout first, so the first thing the lifter does starts it. loggedFor names the
  // exercise when the write logs a set from its card, the only change that ends an exercise or starts a break.
  async apply(
    write: (session: WorkoutSession) => Promise<WorkoutSession>,
    { loggedFor }: { loggedFor?: Exercise['id'] } = {}
  ): Promise<WorkoutSession> {
    const [session, next] = await whileBusy(async () => {
      const session = open ?? (await started())
      const next = await write(session)
      await showNow(next)
      return [session, next] as const
    })
    await actOn(outcomeOf(session, next, loggedFor, getBreakTimeSeconds()))
    return next
  }
}

// Creates the workout and shows it, once, however many changes ask for it at the same time.
const started = (): Promise<WorkoutSession> => {
  if (!starter) throw new Error('No workout session is open')
  const { start } = starter
  starting ??= (async () => {
    const session = await start()
    await showNow(session)
    Toasts.show({ message: 'Workout started.' })
    return session
  })().finally(() => {
    starting = undefined
  })
  return starting
}

// Tells the user when the exercise is already in the workout, which holds each exercise once.
export const alertIfInSession = (exerciseId: Exercise['id']): boolean => {
  if (!openSession.exerciseIds().includes(exerciseId)) return false
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
      stampConfetti('Workout done!')
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
      popConfetti('Exercise done!', document.querySelector(`[data-exercise-id="${CSS.escape(outcome.exerciseId)}"]`))
      return
    case 'rest':
      BreakTimerDialog.start(outcome)
      return
    case 'none':
      return
  }
}
