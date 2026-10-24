import { getWorkoutModeSettings, storeWorkoutModeSettings, type WorkoutMode } from '../../settings'

const MODE_DESCRIPTIONS: Record<WorkoutMode, string> = {
  rotation: 'All programs are expected once per week.',
  freestyle: 'Pick any program to work toward your weekly goal.'
}

class WorkoutModeDialog {
  private static get dialog() {
    return document.querySelector('#workout-mode-dialog') as HTMLDialogElement
  }
  private static get opener() {
    return document.querySelector('#week-progress') as HTMLButtonElement
  }
  private static get modeRadios() {
    return document.querySelectorAll<HTMLInputElement>('input[name="workout-mode"]')
  }
  private static get goalContainer() {
    return document.querySelector('#weekly-goal-container') as HTMLDivElement
  }
  private static get goalInput() {
    return document.querySelector('#weekly-goal-input') as HTMLInputElement
  }
  private static get description() {
    return document.querySelector('#workout-mode-description') as HTMLParagraphElement
  }

  static init() {
    const settings = getWorkoutModeSettings()

    for (const radio of this.modeRadios) {
      if (radio.value === settings.mode) radio.checked = true
      radio.addEventListener('change', () => this.handleModeChange())
    }

    this.goalInput.value = String(settings.weeklyGoal)
    this.goalInput.addEventListener('change', () => this.handleGoalChange())

    this.opener.addEventListener('click', () => this.dialog.showModal())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.dialog.close())

    this.updateUI(settings.mode)
  }

  private static handleModeChange() {
    const selected = this.getSelectedMode()
    const settings = getWorkoutModeSettings()
    storeWorkoutModeSettings({ ...settings, mode: selected })
    this.updateUI(selected)
    window.location.reload()
  }

  private static handleGoalChange() {
    const value = Math.min(7, Math.max(1, parseInt(this.goalInput.value) || 3))
    this.goalInput.value = String(value)
    const settings = getWorkoutModeSettings()
    storeWorkoutModeSettings({ ...settings, weeklyGoal: value })
    window.location.reload()
  }

  private static getSelectedMode(): WorkoutMode {
    for (const radio of this.modeRadios) {
      if (radio.checked) return radio.value as WorkoutMode
    }
    return 'rotation'
  }

  private static updateUI(mode: WorkoutMode) {
    this.goalContainer.classList.toggle('hidden', mode !== 'freestyle')
    this.description.textContent = MODE_DESCRIPTIONS[mode]
  }
}

export default WorkoutModeDialog
