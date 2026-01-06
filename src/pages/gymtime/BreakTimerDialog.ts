import EventEmitter from '../../db/eventEmitter'

type BreakTimerDialogEventMap = {
  'break-finished': void
  'break-skipped': void
}

class BreakTimerDialog extends EventEmitter<BreakTimerDialogEventMap> {
  private breakCountdownDialog = document.querySelector('#break-countdown-dialog') as HTMLDialogElement
  private countdown = this.breakCountdownDialog.querySelector('#countdown') as HTMLHeadingElement
  private countdownInterval: ReturnType<typeof setInterval> | null = null
  private skipBreakButton = this.breakCountdownDialog.querySelector('#skip-break') as HTMLButtonElement
  private setsDone = this.breakCountdownDialog.querySelector('#sets-done') as HTMLParagraphElement
  private nextExercise = this.breakCountdownDialog.querySelector('#next-exercise-name') as HTMLParagraphElement
  private nextExerciseMessage = this.breakCountdownDialog.querySelector(
    '#next-exercise-message'
  ) as HTMLParagraphElement

  constructor() {
    super()
    this.skipBreakButton.addEventListener('click', () => this.skipBreak())
  }

  startTimer({
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
    this.setsDone.textContent = `${setsDone} / ${setsTotal}`
    this.countdown.textContent = `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`
    this.countdownInterval = setInterval(() => {
      const minutes = parseInt(this.countdown.textContent.split(':')[0])
      const seconds = parseInt(this.countdown.textContent.split(':')[1])

      if (minutes === 0 && seconds === 0) {
        this.emit('break-finished', undefined)
        this.closeDialog()
      } else if (seconds === 0) {
        const nextMinutes = minutes - 1
        this.countdown.textContent = `${nextMinutes}:59`
      } else {
        const nextSeconds = seconds - 1
        this.countdown.textContent = `${minutes}:${nextSeconds < 10 ? `0${nextSeconds}` : nextSeconds}`
      }
    }, 1000)

    if (nextExercise) {
      this.nextExerciseMessage.classList.remove('hidden')
      this.nextExercise.textContent = nextExercise
    } else {
      this.nextExerciseMessage.classList.add('hidden')
    }

    this.openDialog()
  }

  openDialog() {
    this.breakCountdownDialog.classList.add('dialog-full-screen')
    this.breakCountdownDialog.showModal()
  }

  closeDialog() {
    if (this.countdownInterval !== null) clearInterval(this.countdownInterval)
    this.breakCountdownDialog.classList.remove('dialog-full-screen')
    this.breakCountdownDialog.close()
  }

  skipBreak() {
    this.emit('break-skipped', undefined)
    this.closeDialog()
  }
}

export default BreakTimerDialog
