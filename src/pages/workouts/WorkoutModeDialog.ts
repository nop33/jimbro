import { getWorkoutModeSettings, storeWorkoutModeSettings, type WorkoutMode } from '../../settings'

const MODE_DESCRIPTIONS: Record<WorkoutMode, string> = {
  rotation: 'All programs are expected once per week.',
  freestyle: 'Pick any program to work toward your weekly goal.'
}

class WorkoutModeDialog {
  private static dialog = document.querySelector('#workout-mode-dialog') as HTMLDialogElement
  private static badge = document.querySelector('#workout-mode-badge') as HTMLButtonElement
  private static modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="workout-mode"]')
  private static goalContainer = document.querySelector('#weekly-goal-container') as HTMLDivElement
  private static goalInput = document.querySelector('#weekly-goal-input') as HTMLInputElement
  private static description = document.querySelector('#workout-mode-description') as HTMLParagraphElement

  static init() {
    const settings = getWorkoutModeSettings()

    for (const radio of this.modeRadios) {
      if (radio.value === settings.mode) radio.checked = true
      radio.addEventListener('change', () => this.handleModeChange())
    }

    this.goalInput.value = String(settings.weeklyGoal)
    this.goalInput.addEventListener('change', () => this.handleGoalChange())

    this.badge.addEventListener('click', () => this.dialog.showModal())
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
    this.updateBadge(mode)
  }

  private static updateBadge(mode: WorkoutMode) {
    if (mode === 'freestyle') {
      const settings = getWorkoutModeSettings()
      this.badge.textContent = `Freestyle (${settings.weeklyGoal}/wk)`
    } else {
      this.badge.textContent = 'Rotation'
    }
  }
}

export default WorkoutModeDialog
