import type { ExerciseKind } from '../../db/exerciseLogging'
import { historyChartEnabled } from '../../db/exerciseLogging'
import { playDingSound } from './sound'

// A break after a set: its length, the exercise's sets logged and to do, and the next exercise with sets to do.
export interface Break {
  seconds: number
  setsDone: number
  setsTotal: number
  next?: string
  exercise: { id: string; name: string; kind: ExerciseKind }
}

// The countdown between sets, full screen or as a bar at the top. One timer serves the whole document, so a break
// keeps counting down whatever page shows under it.
class BreakTimer {
  private dialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  private minimizeButton = this.dialog.querySelector('#minimize-break') as HTMLButtonElement
  private countdown = this.dialog.querySelector('#countdown') as HTMLHeadingElement
  private skipBreakButton = this.dialog.querySelector('#skip-break') as HTMLButtonElement
  private viewHistoryButton = this.dialog.querySelector('#view-history-break') as HTMLButtonElement
  private setsDoneEl = this.dialog.querySelector('#sets-done') as HTMLParagraphElement
  private nextExerciseNameEl = this.dialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  private nextExerciseMessageEl = this.dialog.querySelector('#next-exercise-message') as HTMLParagraphElement
  private countdownInterval: ReturnType<typeof setInterval> | null = null
  private targetTime: number | null = null
  private hasPlayedSound = false
  private autoCloseTimeout: ReturnType<typeof setTimeout> | null = null
  private currentExercise: Break['exercise'] | null = null
  private isMinimized = false
  // How the page on screen opens an exercise's history, while it offers one.
  private openHistory: ((exercise: Break['exercise']) => void) | null = null

  constructor() {
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
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange())
  }

  // The full timer offers the exercise's history through open until signal aborts, as when the page goes.
  offerHistory(open: (exercise: Break['exercise']) => void, signal: AbortSignal) {
    this.openHistory = open
    this.showHistoryButton()
    signal.addEventListener('abort', () => {
      if (this.openHistory !== open) return
      this.openHistory = null
      this.showHistoryButton()
    })
  }

  private showHistoryButton() {
    const exercise = this.currentExercise
    const offered = this.openHistory !== null && exercise !== null && historyChartEnabled(exercise.kind)
    this.viewHistoryButton.classList.toggle('hidden', !offered)
  }

  private minimizeDialog() {
    this.isMinimized = true
    this.morph(() => {
      this.dialog.close()
      this.dialog.classList.remove('dialog-full-screen')
      this.dialog.classList.add('dialog-minimized')
      this.dialog.show()
    })
  }

  private maximizeDialog() {
    this.isMinimized = false
    this.morph(() => {
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

  private handleVisibilityChange() {
    if (document.visibilityState === 'visible' && this.targetTime !== null) {
      this.updateTimerDisplay()
    }
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
  start({ seconds, setsDone, setsTotal, next, exercise }: Break) {
    this.stopCountdown()
    this.currentExercise = exercise
    this.showHistoryButton()
    this.setsDoneEl.textContent = `${setsDone} / ${setsTotal}`
    this.targetTime = Date.now() + seconds * 1000

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
    this.targetTime = null
    this.hasPlayedSound = false
    this.currentExercise = null
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
