import { getBreakTimeSeconds, storeBreakTimeSeconds } from '../../settings'

// Break time: a stepper that takes 15 seconds off or adds 15, between 15 seconds and 10 minutes, and saves each
// change at once. A time stored off the 15 second grid, from the old minutes and seconds fields, steps onto it.
const STEP = 15
const MIN = 15
const MAX = 600

export const formatBreakTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

export const stepBreakTime = (seconds: number, direction: 1 | -1) => {
  const onGrid = direction > 0 ? Math.floor(seconds / STEP) * STEP + STEP : Math.ceil(seconds / STEP) * STEP - STEP
  return Math.min(MAX, Math.max(MIN, onGrid))
}

export default class BreakTimeStepper {
  private output = document.querySelector('#break-time') as HTMLOutputElement
  private less = document.querySelector('#break-time-less') as HTMLButtonElement
  private more = document.querySelector('#break-time-more') as HTMLButtonElement

  constructor() {
    this.show(getBreakTimeSeconds())
    this.less.addEventListener('click', () => this.step(-1))
    this.more.addEventListener('click', () => this.step(1))
  }

  private step(direction: 1 | -1) {
    const seconds = stepBreakTime(getBreakTimeSeconds(), direction)
    storeBreakTimeSeconds(seconds)
    this.show(seconds)
  }

  private show(seconds: number) {
    this.output.value = formatBreakTime(seconds)
    this.less.disabled = seconds <= MIN
    this.more.disabled = seconds >= MAX
  }
}
