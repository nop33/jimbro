import { account } from '../../sync/account'
import { exportIndexedDbToJson } from '../../db/export'
import type { Exercise } from '../../db/stores/exercisesStore'
import type { WorkoutSession } from '../../db/types'
import { popConfetti, stampConfetti } from '../../features/confetti'
import Toasts from '../../features/toasts'
import { getBreakTimeSeconds } from '../../settings'
import { breakTimer } from '../../features/breakTimer'
import type PasskeyOfferCard from './PasskeyOfferCard'
import { outcomeOf, type Outcome } from './outcome'

// Shows the open session on screen, and resolves once the screen shows it or a later one.
type View = (session: WorkoutSession | undefined) => void | Promise<void>

// Starts the workout the page shows before one exists, and the exercises it will start with.
export interface Starter {
  start: () => Promise<WorkoutSession>
  exerciseIds: () => Array<Exercise['id']>
}

// Every change to the open session, whatever caused it, reaches the screen the same way: it is stored here, then
// every view shows it. The gymtime page makes one for each workout it shows.
export class OpenSession {
  // The workout the page shows, or undefined until the first change starts one.
  private open: WorkoutSession | undefined
  private views = new Set<View>()
  private starter: Starter | undefined
  // The start on its way, so changes made before it lands write to the one workout it creates.
  private starting: Promise<WorkoutSession> | undefined
  // Writes and the views showing their result, still running. The region is aria-busy while any is.
  private running = 0
  private busyRegion: HTMLElement | undefined
  private passkeyOffer: PasskeyOfferCard

  // passkeyOffer is the card a finished workout offers a passkey backup on.
  constructor(passkeyOffer: PasskeyOfferCard) {
    this.passkeyOffer = passkeyOffer
  }

  get current(): WorkoutSession | undefined {
    return this.open
  }

  subscribe(view: View): () => void {
    this.views.add(view)
    return () => this.views.delete(view)
  }

  // While a change is on its way to the screen, region carries aria-busy, so assistive technology waits
  // for it, and so can the specs.
  busyOn(region: HTMLElement): void {
    this.busyRegion = region
    if (this.running > 0) region.setAttribute('aria-busy', 'true')
  }

  // Shows the session the page loaded.
  async show(session: WorkoutSession | undefined): Promise<void> {
    await this.whileBusy(() => this.showNow(session))
  }

  // How the first change starts the workout when the page opened none.
  startWith(next: Starter): void {
    this.starter = next
  }

  // The exercises the open session holds, or the ones the start will store.
  exerciseIds(): Array<Exercise['id']> {
    return this.open ? this.open.exercises.map(({ exerciseId }) => exerciseId) : (this.starter?.exerciseIds() ?? [])
  }

  // Runs a workoutSessionsStore write on the open session and resolves once the screen shows the session it stored
  // and the lifter has heard what the change means. Nothing changes on screen before the write lands. With no session
  // open, the write starts the workout first, so the first thing the lifter does starts it. loggedFor names the
  // exercise when the write logs a set from its card, the only change that ends an exercise or starts a break.
  async apply(
    write: (session: WorkoutSession) => Promise<WorkoutSession>,
    { loggedFor }: { loggedFor?: Exercise['id'] } = {}
  ): Promise<WorkoutSession> {
    const [session, next] = await this.whileBusy(async () => {
      const session = this.open ?? (await this.started())
      const next = await write(session)
      await this.showNow(next)
      return [session, next] as const
    })
    await this.actOn(outcomeOf(session, next, loggedFor, getBreakTimeSeconds()))
    return next
  }

  // Tells the user when the exercise is already in the workout, which holds each exercise once.
  alertIfHolds(exerciseId: Exercise['id']): boolean {
    if (!this.exerciseIds().includes(exerciseId)) return false
    alert('This exercise is already in your session.')
    return true
  }

  private async whileBusy<T>(work: () => Promise<T>): Promise<T> {
    if (this.running++ === 0) this.busyRegion?.setAttribute('aria-busy', 'true')
    try {
      return await work()
    } finally {
      if (--this.running === 0) this.busyRegion?.removeAttribute('aria-busy')
    }
  }

  private async showNow(session: WorkoutSession | undefined): Promise<void> {
    this.open = session
    await Promise.all([...this.views].map(async (view) => view(session)))
  }

  // Creates the workout and shows it, once, however many changes ask for it at the same time.
  private started(): Promise<WorkoutSession> {
    if (!this.starter) throw new Error('No workout session is open')
    const { start } = this.starter
    this.starting ??= (async () => {
      const session = await start()
      await this.showNow(session)
      Toasts.show({ message: 'Workout started.' })
      return session
    })().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  // A finished workout or exercise ends the break, and a finished workout is celebrated every time: an exercise or
  // set added afterwards makes it incomplete again. Without cloud backup, a finished workout also downloads a JSON
  // export, the only copy outside this browser. Without a passkey backup, it also offers one.
  private async actOn(outcome: Outcome): Promise<void> {
    switch (outcome.kind) {
      case 'workout-done':
        navigator.vibrate?.(WORKOUT_DONE_VIBRATION)
        breakTimer().close()
        stampConfetti('Workout done!')
        this.passkeyOffer.offer()
        if (account.current()) return
        try {
          await exportIndexedDbToJson()
        } catch (error) {
          console.error('Error exporting database:', error)
          Toasts.show({ message: 'Could not download the JSON export.', type: 'error' })
        }
        return
      case 'exercise-done':
        navigator.vibrate?.(EXERCISE_DONE_VIBRATION)
        breakTimer().close()
        popConfetti('Exercise done!', document.querySelector(`[data-exercise-id="${CSS.escape(outcome.exerciseId)}"]`))
        return
      case 'rest':
        breakTimer().start(outcome)
        return
      case 'none':
        return
    }
  }
}

// Vibration patterns, in ms of buzz and pause: a short triple for an exercise, and a "ta-da-da-daaa" fanfare for the
// workout. Safari has no Vibration API, so both are silent there.
const EXERCISE_DONE_VIBRATION = [50, 30, 50, 30, 70]
const WORKOUT_DONE_VIBRATION = [60, 40, 60, 40, 60, 80, 400]
