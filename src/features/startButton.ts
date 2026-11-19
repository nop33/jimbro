import { getSimpleDate } from '../dateUtils'
import { programsStore } from '../db/stores/programsStore'
import { progressOf, workoutSessionsStore } from '../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../db/types'
import { pickPrograms } from '../pages/programPicks'
import { redraw } from '../redraw'
import { getWorkoutModeSettings } from '../settings'
import { onPageNotice } from '../sync/pageChannel'
import { trainingWeeks } from '../weeks'
import { pullDownToClose } from './bottomSheet'
import { breakTimer } from './breakTimer'
import Toasts from './toasts'

// The Start button in the middle of the bottom nav. Before a workout, a tap starts the one Home suggests. While one
// runs today, the button shows how long it has run, with a ring of its exercises done, and a tap offers to finish it
// early, in a sheet that asks first.

// What the workout page lets the button do with the workout it shows, so the change reaches its screen, and has its
// effects, the way the page's own changes do.
export interface WorkoutPage {
  // The workout the page shows, or undefined before it starts.
  current: () => WorkoutSession | undefined
  // Starts the workout the page shows.
  start: () => Promise<void>
  // Finishes the workout the page shows.
  finish: () => Promise<void>
}

// The workout page on screen, which registers itself while it shows.
let workoutPage: WorkoutPage | undefined

export const onWorkoutPage = (page: WorkoutPage, signal: AbortSignal) => {
  workoutPage = page
  signal.addEventListener('abort', () => {
    if (workoutPage === page) workoutPage = undefined
  })
}

// 32:10, or 1:05:12 past an hour.
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Where a tap on Start goes: a workout of the suggested program, started on arrival, or the suggested workout left
// unfinished this week, which it continues. Without programs there is nothing to start, so it goes to make one.
const nextWorkoutUrl = async (): Promise<string> => {
  const [sessions, programs] = await Promise.all([workoutSessionsStore.getAll(), programsStore.load()])
  const settings = getWorkoutModeSettings()
  const { goal, weeks, programs: statuses } = trainingWeeks(sessions, programs, settings)
  const suggested = pickPrograms(statuses, weeks[0].counted, goal, settings).find((pick) => pick.isSuggested)
  if (!suggested) return '/programs/'
  if (suggested.thisWeek?.status === 'incomplete') return `/gymtime/?id=${suggested.thisWeek.id}`
  return `/gymtime/?programId=${suggested.program.id}&start`
}

const exercisesDone = (session: WorkoutSession) =>
  session.exercises.filter((exercise) => progressOf(exercise).done).length

class StartButton {
  private button = document.querySelector('#start-button') as HTMLButtonElement
  private time = this.button.querySelector('.nav-start-time') as HTMLSpanElement
  private label = this.button.querySelector('.nav-start-label') as HTMLSpanElement
  private ring = this.button.querySelector('.nav-start-done') as SVGCircleElement
  private dialog = document.querySelector('#finish-workout-dialog') as HTMLDialogElement
  private elapsed = this.dialog.querySelector('#finish-workout-elapsed') as HTMLSpanElement
  private goLink = this.dialog.querySelector('#finish-workout-go') as HTMLAnchorElement
  private confirmButton = this.dialog.querySelector('#finish-workout-confirm') as HTMLButtonElement
  // The workout running today, if any.
  private running: WorkoutSession | undefined
  private ticking = 0
  private busy = false
  private signal: AbortSignal

  constructor(signal: AbortSignal) {
    this.signal = signal
    pullDownToClose(this.dialog)
    this.button.addEventListener('click', () => void this.tap())
    this.confirmButton.addEventListener('click', () => void this.finish())
    // A link tap leaves the sheet open under the next page's view transition otherwise.
    this.goLink.addEventListener('click', () => this.dialog.close())
    onPageNotice((notice) => {
      if (notice === 'rows-written') void this.refresh()
    }, signal)
    signal.addEventListener('abort', () => this.stopTicking())
  }

  async refresh() {
    const running = await workoutSessionsStore.runningOn(getSimpleDate(new Date()))
    if (this.signal.aborted) return
    this.running = running
    this.draw()
  }

  private draw() {
    const session = this.running
    this.button.toggleAttribute('data-running', session !== undefined)
    // Until the button has read whether a workout runs, it shows Start, so the specs and the tour wait for this.
    this.button.dataset.state = session ? 'running' : 'idle'
    if (!session) {
      this.stopTicking()
      this.label.textContent = 'Start'
      this.button.setAttribute('aria-label', 'Start next workout')
      return
    }
    this.label.textContent = 'Finish'
    const total = session.exercises.length
    const done = total > 0 ? exercisesDone(session) / total : 0
    this.ring.setAttribute('stroke-dasharray', `${done * 100} 100`)
    // A round cap draws a dot even for nothing done.
    this.ring.style.visibility = done > 0 ? '' : 'hidden'
    this.tick()
    if (this.ticking === 0 && session.startedAt) this.ticking = window.setInterval(() => this.tick(), 1000)
  }

  // Shows the running time on the button, and in the sheet while it is open.
  private tick() {
    const startedAt = this.running?.startedAt
    // A workout stored before its start was kept has no running time, so the disc shows only the ring.
    const text = startedAt ? formatElapsed(Date.now() - new Date(startedAt).getTime()) : ''
    this.time.textContent = text
    this.time.toggleAttribute('data-hours', text.length > 5)
    this.button.setAttribute('aria-label', text ? `Finish workout, ${text} in` : 'Finish workout')
    this.elapsed.textContent = text ? `· ${text}` : ''
  }

  private stopTicking() {
    window.clearInterval(this.ticking)
    this.ticking = 0
  }

  private async tap() {
    if (this.busy) return
    this.busy = true
    try {
      if (this.running) {
        await this.offerFinish(this.running)
        return
      }
      // On the page of a workout not started yet, Start starts that one.
      if (workoutPage && !workoutPage.current()) {
        await workoutPage.start()
        return
      }
      window.location.assign(await nextWorkoutUrl())
    } finally {
      this.busy = false
    }
  }

  private async offerFinish(session: WorkoutSession) {
    const program = await programsStore.getById(session.programId)
    const done = exercisesDone(session)
    const total = session.exercises.length
    ;(this.dialog.querySelector('#finish-workout-name') as HTMLSpanElement).textContent = program?.name ?? 'Workout'
    ;(this.dialog.querySelector('#finish-workout-started') as HTMLSpanElement).textContent = session.startedAt
      ? new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'today'
    ;(this.dialog.querySelector('#finish-workout-left') as HTMLParagraphElement).textContent =
      `${done} of ${total} ${total === 1 ? 'exercise' : 'exercises'} done. The sets left stay undone, and the workout counts as done.`
    this.goLink.href = `/gymtime/?id=${session.id}`
    this.goLink.hidden = workoutPage?.current()?.id === session.id
    this.tick()
    this.dialog.showModal()
  }

  // On the workout's own page, the page finishes it, so it celebrates as a workout done there does. Anywhere else the
  // workout finishes here, its break ends with it, and the page draws again to show it done.
  private async finish() {
    const session = this.running
    this.dialog.close()
    if (!session) return
    if (workoutPage?.current()?.id === session.id) {
      await workoutPage.finish()
      return
    }
    try {
      await workoutSessionsStore.finish(session)
    } catch (error) {
      console.error('Finishing the workout failed', error)
      Toasts.show({ message: 'Could not finish the workout. Try again.', type: 'error' })
      return
    }
    breakTimer().closeFor(session.id)
    Toasts.show({ message: 'Workout finished' })
    await redraw()
  }
}

// Wires the Start button of the page on screen, until signal aborts as the next page replaces it.
export const wireStartButton = (signal: AbortSignal) => {
  if (!document.querySelector('#start-button')) return
  void new StartButton(signal).refresh()
}
