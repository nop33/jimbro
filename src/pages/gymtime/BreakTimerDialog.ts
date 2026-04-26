import type { Exercise } from '../../db/stores/exercisesStore'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import { playDingSound } from './sound'

class BreakTimerDialog {
  private static dialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  private static minimizeButton = this.dialog.querySelector('#minimize-break') as HTMLButtonElement
  private static countdown = this.dialog.querySelector('#countdown') as HTMLHeadingElement
  private static countdownInterval: ReturnType<typeof setInterval> | null = null
  private static skipBreakButton = this.dialog.querySelector('#skip-break') as HTMLButtonElement
  private static viewHistoryButton = this.dialog.querySelector('#view-history-break') as HTMLButtonElement
  private static setsDoneEl = this.dialog.querySelector('#sets-done') as HTMLParagraphElement
  private static nextExerciseNameEl = this.dialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  private static nextExerciseMessageEl = this.dialog.querySelector('#next-exercise-message') as HTMLParagraphElement
  private static targetTime: number | null = null
  private static hasPlayedSound = false
  private static autoCloseTimeout: ReturnType<typeof setTimeout> | null = null
  private static currentExercise: Exercise | null = null
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
      if (this.currentExercise) ExerciseHistoryChart.openDialog(this.currentExercise)
    })
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange())
  }

  private static minimizeDialog() {
    this.isMinimized = true
    this.dialog.close()
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.classList.add('dialog-minimized')
    this.dialog.show()
  }

  private static maximizeDialog() {
    this.isMinimized = false
    this.dialog.close()
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.classList.add('dialog-full-screen')
    this.dialog.showModal()
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

    // Calculate the difference in seconds first to properly hit 0:00
    const diffSecs = Math.ceil(diffMs / 1000)
    const isNegative = diffSecs < 0
    const absDiffSecs = Math.abs(diffSecs)

    const mins = Math.floor(absDiffSecs / 60)
    const secs = absDiffSecs % 60

    const timeString = `${mins}:${secs < 10 ? `0${secs}` : secs}`
    this.countdown.textContent = isNegative ? `-${timeString}` : timeString

    if (diffMs <= 0 && !this.hasPlayedSound) {
      playDingSound()
      this.hasPlayedSound = true
    }

    if (diffMs <= 0 && this.autoCloseTimeout === null && document.visibilityState === 'visible') {
      this.autoCloseTimeout = setTimeout(() => {
        this.closeDialog()
      }, 1500)
    }
  }

  static startTimer({
    minutes,
    seconds,
    setsDone,
    setsTotal,
    nextExercise,
    currentExercise
  }: {
    minutes: number
    seconds: number
    setsDone: number
    setsTotal: number
    nextExercise?: string
    currentExercise: Exercise
  }) {
    this.currentExercise = currentExercise
    this.setsDoneEl.textContent = `${setsDone} / ${setsTotal}`
    this.hasPlayedSound = false

    const totalMs = (minutes * 60 + seconds) * 1000
    this.targetTime = Date.now() + totalMs

    this.updateTimerDisplay()

    this.countdownInterval = setInterval(() => {
      this.updateTimerDisplay()
    }, 1000)

    if (nextExercise) {
      this.nextExerciseMessageEl.classList.remove('hidden')
      this.nextExerciseNameEl.textContent = nextExercise
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

  static closeDialog() {
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
    this.isMinimized = false
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.classList.remove('dialog-minimized')
    this.dialog.close()
  }
}

export default BreakTimerDialog
