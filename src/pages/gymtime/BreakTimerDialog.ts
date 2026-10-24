import { historyChartEnabled } from '../../db/exerciseLogging'
import ExerciseHistoryChart, { type ExerciseHistoryTarget } from './ExerciseHistoryChart'
import type { Rest } from './outcome'
import { playDingSound } from './sound'

class BreakTimerDialog {
  private static get dialog() {
    return document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  }
  private static get minimizeButton() {
    return this.dialog.querySelector('#minimize-break') as HTMLButtonElement
  }
  private static get countdown() {
    return this.dialog.querySelector('#countdown') as HTMLHeadingElement
  }
  private static countdownInterval: ReturnType<typeof setInterval> | null = null
  private static get skipBreakButton() {
    return this.dialog.querySelector('#skip-break') as HTMLButtonElement
  }
  private static get viewHistoryButton() {
    return this.dialog.querySelector('#view-history-break') as HTMLButtonElement
  }
  private static get setsDoneEl() {
    return this.dialog.querySelector('#sets-done') as HTMLParagraphElement
  }
  private static get nextExerciseNameEl() {
    return this.dialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  }
  private static get nextExerciseMessageEl() {
    return this.dialog.querySelector('#next-exercise-message') as HTMLParagraphElement
  }
  private static targetTime: number | null = null
  private static hasPlayedSound = false
  private static autoCloseTimeout: ReturnType<typeof setTimeout> | null = null
  private static currentExercise: ExerciseHistoryTarget | null = null
  private static isMinimized = false

  static init() {
    this.skipBreakButton.addEventListener('click', () => this.closeDialog())
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
      if (this.currentExercise) void ExerciseHistoryChart.openDialog(this.currentExercise)
    })
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange())
  }

  private static minimizeDialog() {
    this.isMinimized = true
    this.morph(() => {
      this.dialog.close()
      this.dialog.classList.remove('dialog-full-screen')
      this.dialog.classList.add('dialog-minimized')
      this.dialog.show()
    })
  }

  private static maximizeDialog() {
    this.isMinimized = false
    this.showHistoryButton()
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
  private static morph(swap: () => void) {
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

  // The history chart lives on the gymtime page, so the timer offers it only there.
  private static showHistoryButton() {
    const exercise = this.currentExercise
    const offered = exercise !== null && historyChartEnabled(exercise.kind) && ExerciseHistoryChart.onPage()
    this.viewHistoryButton.classList.toggle('hidden', !offered)
  }

  private static handleVisibilityChange() {
    if (document.visibilityState === 'visible' && this.targetTime !== null) {
      this.updateTimerDisplay()
    }
  }

  private static updateTimerDisplay() {
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
        this.closeDialog()
      }, 1000)
    }
  }

  // Starts a break, in place of any break still running.
  static start({ seconds, setsDone, setsTotal, next, exercise }: Rest) {
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

  private static openDialog() {
    this.isMinimized = false
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.classList.add('dialog-full-screen')
    if (this.dialog.open) {
      this.dialog.close()
    }
    this.dialog.showModal()
  }

  // Stops the countdown, its ding and its pending auto-close, and forgets the break.
  private static stopCountdown() {
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

  static closeDialog() {
    this.stopCountdown()
    this.isMinimized = false
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.close()
  }
}

export default BreakTimerDialog
