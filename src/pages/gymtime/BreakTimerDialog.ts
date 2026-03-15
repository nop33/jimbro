import { playDingSound } from './sound'

class BreakTimerDialog {
  private static dialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  private static countdown = this.dialog.querySelector('#countdown') as HTMLHeadingElement
  private static countdownInterval: ReturnType<typeof setInterval> | null = null
  private static skipBreakButton = this.dialog.querySelector('#skip-break') as HTMLButtonElement
  private static setsDoneEl = this.dialog.querySelector('#sets-done') as HTMLParagraphElement
  private static nextExerciseNameEl = this.dialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  private static nextExerciseMessageEl = this.dialog.querySelector('#next-exercise-message') as HTMLParagraphElement

  static init() {
    this.skipBreakButton.addEventListener('click', () => this.closeDialog())
  }

  static startTimer({
    minutes,
    seconds,
    setsDone,
    setsTotal,
    nextExercise
  }: {
    minutes: number
    seconds: number
    setsDone: number
    setsTotal: number
    nextExercise?: string
  }) {
    this.setsDoneEl.textContent = `${setsDone} / ${setsTotal}`
    this.countdown.textContent = `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`
    this.countdownInterval = setInterval(() => {
      const mins = parseInt(this.countdown.textContent.split(':')[0])
      const secs = parseInt(this.countdown.textContent.split(':')[1])

      if (mins === 0 && secs === 0) {
        playDingSound()
        this.closeDialog()
      } else if (secs === 0) {
        this.countdown.textContent = `${mins - 1}:59`
      } else {
        const next = secs - 1
        this.countdown.textContent = `${mins}:${next < 10 ? `0${next}` : next}`
      }
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
    this.dialog.classList.add('dialog-full-screen')
    this.dialog.showModal()
  }

  static closeDialog() {
    if (this.countdownInterval !== null) clearInterval(this.countdownInterval)
    this.dialog.classList.remove('dialog-full-screen')
    this.dialog.close()
  }
}

export default BreakTimerDialog
