import type { ExerciseKind } from '../../db/exerciseLogging'
import { historyChartEnabled } from '../../db/exerciseLogging'
import { breakAlertsOn, cancelBreakAlert, scheduleBreakAlert } from '../../sync/breakAlerts'
import { playDingSound } from './sound'

// A break after a set in a workout: its length, the exercise's sets logged and to do, and the next exercise with sets
// to do.
export interface Break {
  sessionId: string
  seconds: number
  setsDone: number
  setsTotal: number
  next?: string
  exercise: { id: string; name: string; kind: ExerciseKind }
}

// The countdown between sets, full screen or as a bar on the bottom nav. One timer serves the whole document, so a break
// keeps counting down whatever page shows under it.
class BreakTimer {
  private dialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  private minimizeButton = this.dialog.querySelector('#minimize-break') as HTMLButtonElement
  private countdown = this.dialog.querySelector('#countdown') as HTMLHeadingElement
  private skipBreakButton = this.dialog.querySelector('#skip-break') as HTMLButtonElement
  private viewHistoryButton = this.dialog.querySelector('#view-history-break') as HTMLButtonElement
  private backToWorkoutLink = this.dialog.querySelector('#back-to-workout') as HTMLAnchorElement
  private setsDoneEl = this.dialog.querySelector('#sets-done') as HTMLParagraphElement
  private nextExerciseNameEl = this.dialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  private nextExerciseMessageEl = this.dialog.querySelector('#next-exercise-message') as HTMLParagraphElement
  private countdownInterval: ReturnType<typeof setInterval> | null = null
  private targetTime: number | null = null
  private hasPlayedSound = false
  private autoCloseTimeout: ReturnType<typeof setTimeout> | null = null
  private currentExercise: Break['exercise'] | null = null
  private sessionId: Break['sessionId'] | null = null
  private isMinimized = false
  // The next exercise's name, for the alert at the end of the break.
  private next: string | undefined
  // Whether the worker holds an alert for this break, which it sends unless the page comes back first.
  private alertScheduled = false
  // How the workout's page opens an exercise's history, while it shows.
  private openHistory: ((exercise: Break['exercise']) => void) | null = null
  // Whether the last pointer dragged the timer, so the click its release fires taps nothing, not even the bar.
  private dragged = false

  constructor() {
    this.swipeToResize()
    this.skipBreakButton.addEventListener('click', () => this.close())
    this.minimizeButton.addEventListener('click', (e) => {
      e.stopPropagation()
      this.minimizeDialog()
    })
    this.dialog.addEventListener('click', () => {
      if (this.isMinimized) {
        this.maximizeDialog()
      }
    })
    this.viewHistoryButton.addEventListener('click', () => {
      if (this.currentExercise) this.openHistory?.(this.currentExercise)
    })
    // The link goes to the workout with the break running, as the bar on the bottom nav, so the workout shows with it.
    this.backToWorkoutLink.addEventListener('click', (event) => {
      event.stopPropagation()
      this.showMinimized()
    })
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange())
  }

  // While the workout's page shows, until signal aborts, the full timer offers the exercise's history through
  // openHistory. On any other page it offers a link back to the workout instead.
  onWorkoutPage(openHistory: (exercise: Break['exercise']) => void, signal: AbortSignal) {
    this.openHistory = openHistory
    this.showWayToWorkout()
    signal.addEventListener('abort', () => {
      if (this.openHistory !== openHistory) return
      this.openHistory = null
      this.showWayToWorkout()
    })
  }

  private showWayToWorkout() {
    const exercise = this.currentExercise
    const onWorkoutPage = this.openHistory !== null
    this.viewHistoryButton.classList.toggle(
      'hidden',
      !onWorkoutPage || exercise === null || !historyChartEnabled(exercise.kind)
    )
    this.backToWorkoutLink.hidden = onWorkoutPage || this.sessionId === null
    if (this.sessionId !== null) this.backToWorkoutLink.href = `/gymtime/?id=${this.sessionId}`
  }

  // The timer follows a finger that swipes it, as a sheet does: the full timer down into its bar, and the bar up into the
  // full timer. Pulled far enough or flicked, it changes; let go before then, it slides back. A move under the slop is
  // still a tap on whatever it started on, so the timer takes the pointer only once it moves further.
  private swipeToResize() {
    const slop = 10
    // Down (1) minimizes the full timer, and up (-1) opens the bar.
    let swipe: {
      pointerId: number
      direction: 1 | -1
      startY: number
      dragging: boolean
      y: number
      time: number
      speed: number
    } | null = null

    this.dialog.addEventListener('pointerdown', (event) => {
      this.dragged = false
      if (!event.isPrimary) return
      swipe = {
        pointerId: event.pointerId,
        direction: this.isMinimized ? -1 : 1,
        startY: event.clientY,
        dragging: false,
        y: event.clientY,
        time: 0,
        speed: 0
      }
    })
    this.dialog.addEventListener('pointermove', (event) => {
      if (swipe?.pointerId !== event.pointerId) return
      // How far, and how fast in pixels per millisecond over the last move, the finger went the way that changes it.
      const distance = (event.clientY - swipe.startY) * swipe.direction
      if (!swipe.dragging) {
        if (distance < -slop) {
          swipe = null
          return
        }
        if (distance <= slop) return
        swipe.dragging = true
        this.dialog.setPointerCapture(event.pointerId)
        this.dialog.style.transition = 'none'
      }
      if (swipe.time > 0) {
        swipe.speed = ((event.clientY - swipe.y) * swipe.direction) / Math.max(event.timeStamp - swipe.time, 1)
      }
      swipe.y = event.clientY
      swipe.time = event.timeStamp
      this.dialog.style.translate = `0 ${Math.max(distance, 0) * swipe.direction}px`
    })
    const release = (event: PointerEvent) => {
      if (swipe?.pointerId !== event.pointerId) return
      const { dragging, direction, startY, speed } = swipe
      swipe = null
      if (!dragging) return
      this.dragged = true
      this.dialog.style.transition = ''
      const distance = event.type === 'pointerup' ? (event.clientY - startY) * direction : 0
      const far = direction === 1 ? Math.min(120, innerHeight / 5) : 60
      if (distance > far || (distance > 40 && speed > 0.5)) {
        if (direction === 1) this.minimizeDialog()
        else this.maximizeDialog()
      } else {
        this.dialog.style.translate = ''
      }
    }
    this.dialog.addEventListener('pointerup', release)
    this.dialog.addEventListener('pointercancel', release)
    this.dialog.addEventListener(
      'click',
      (event) => {
        if (!this.dragged) return
        this.dragged = false
        event.stopImmediatePropagation()
      },
      { capture: true }
    )
  }

  private minimizeDialog() {
    this.morph(() => this.showMinimized())
  }

  private showMinimized() {
    this.isMinimized = true
    this.dialog.style.translate = ''
    this.dialog.close()
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.classList.add('dialog-minimized')
    this.dialog.show()
  }

  private maximizeDialog() {
    this.isMinimized = false
    this.morph(() => {
      this.dialog.style.translate = ''
      this.dialog.close()
      this.dialog.classList.remove('dialog-minimized')
      this.dialog.classList.add('dialog-full-screen')
      this.dialog.showModal()
    })
  }

  // A view transition snapshots the timer before and after the swap and morphs one into the other: the box between
  // the full screen and the bar, and the countdown between its two sizes. The dialog's own fade-in waits it out, since
  // reopening the dialog would start it again, and the header and nav morph with the page under the timer.
  private morph(swap: () => void) {
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      swap()
      return
    }
    this.dialog.style.transition = 'none'
    document.documentElement.classList.add('morphing-break-timer')
    const transition = document.startViewTransition(swap)
    void transition.finished.finally(() => {
      this.dialog.style.transition = ''
      document.documentElement.classList.remove('morphing-break-timer')
    })
  }

  // Out of sight, the page can't ring at the end of the break, so it asks the worker to notify the phone then. Back in
  // sight, the page rings itself again, and the alert is cancelled.
  private handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.scheduleAlert()
      return
    }
    this.cancelAlert()
    if (this.targetTime !== null) this.updateTimerDisplay()
  }

  private scheduleAlert() {
    if (this.targetTime === null || this.targetTime <= Date.now() || this.sessionId === null || !breakAlertsOn()) return
    scheduleBreakAlert({
      endsAt: this.targetTime,
      title: 'Break over',
      body: this.next ? `Next: ${this.next}` : `Back to ${this.currentExercise?.name ?? 'your workout'}`,
      url: `/gymtime/?id=${this.sessionId}`
    })
    this.alertScheduled = true
  }

  private cancelAlert() {
    if (!this.alertScheduled) return
    this.alertScheduled = false
    cancelBreakAlert()
  }

  private updateTimerDisplay() {
    if (this.targetTime === null) return

    const now = Date.now()
    const diffMs = this.targetTime - now

    // Round up, so each number shows for a full second and 0:00 shows once the break is over. It stops at 0:00.
    const diffSecs = Math.max(Math.ceil(diffMs / 1000), 0)
    const mins = Math.floor(diffSecs / 60)
    const secs = diffSecs % 60
    this.countdown.textContent = `${mins}:${secs < 10 ? `0${secs}` : secs}`

    if (diffMs <= 0 && !this.hasPlayedSound) {
      playDingSound()
      this.hasPlayedSound = true
    }

    if (diffMs <= 0 && this.autoCloseTimeout === null && document.visibilityState === 'visible') {
      this.autoCloseTimeout = setTimeout(() => {
        this.close()
      }, 1000)
    }
  }

  // Starts a break, in place of any break still running.
  start({ sessionId, seconds, setsDone, setsTotal, next, exercise }: Break) {
    this.stopCountdown()
    this.currentExercise = exercise
    this.sessionId = sessionId
    this.showWayToWorkout()
    this.setsDoneEl.textContent = `${setsDone} / ${setsTotal}`
    this.targetTime = Date.now() + seconds * 1000
    this.next = next

    this.updateTimerDisplay()

    this.countdownInterval = setInterval(() => {
      this.updateTimerDisplay()
    }, 1000)

    if (next) {
      this.nextExerciseMessageEl.classList.remove('hidden')
      this.nextExerciseNameEl.textContent = next
    } else {
      this.nextExerciseMessageEl.classList.add('hidden')
    }

    this.openDialog()
  }

  private openDialog() {
    this.isMinimized = false
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.classList.add('dialog-full-screen')
    if (this.dialog.open) {
      this.dialog.close()
    }
    this.dialog.showModal()
  }

  // Stops the countdown, its ding and its pending auto-close, and forgets the break.
  private stopCountdown() {
    if (this.autoCloseTimeout !== null) {
      clearTimeout(this.autoCloseTimeout)
      this.autoCloseTimeout = null
    }
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval)
      this.countdownInterval = null
    }
    this.cancelAlert()
    this.targetTime = null
    this.next = undefined
    this.hasPlayedSound = false
    this.currentExercise = null
    this.sessionId = null
  }

  // Ends the break, early or on time.
  close() {
    this.stopCountdown()
    this.isMinimized = false
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.close()
  }
}

let timer: BreakTimer | undefined

// The document's one break timer, made the first time something needs it.
export const breakTimer = () => (timer ??= new BreakTimer())
