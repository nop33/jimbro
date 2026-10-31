import { redraw } from '../../redraw'
import { getWorkoutModeSettings, storeWorkoutModeSettings, type WorkoutMode } from '../../settings'

const MODE_DESCRIPTIONS: Record<WorkoutMode, string> = {
  rotation: 'All programs are expected once per week.',
  freestyle: 'Pick any program to work toward your weekly goal.'
}

class WorkoutModeDialog {
  private dialog = document.querySelector('#workout-mode-dialog') as HTMLDialogElement
  private opener = document.querySelector('#week-progress') as HTMLButtonElement
  private modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="workout-mode"]')
  private goalContainer = document.querySelector('#weekly-goal-container') as HTMLDivElement
  private goalInput = document.querySelector('#weekly-goal-input') as HTMLInputElement
  private description = document.querySelector('#workout-mode-description') as HTMLParagraphElement

  constructor() {
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

  private handleModeChange() {
    const selected = this.getSelectedMode()
    const settings = getWorkoutModeSettings()
    storeWorkoutModeSettings({ ...settings, mode: selected })
    this.updateUI(selected)
    void redraw()
  }

  private handleGoalChange() {
    const value = Math.min(7, Math.max(1, parseInt(this.goalInput.value) || 3))
    this.goalInput.value = String(value)
    const settings = getWorkoutModeSettings()
    storeWorkoutModeSettings({ ...settings, weeklyGoal: value })
    void redraw()
  }

  private getSelectedMode(): WorkoutMode {
    for (const radio of this.modeRadios) {
      if (radio.checked) return radio.value as WorkoutMode
    }
    return 'rotation'
  }

  private updateUI(mode: WorkoutMode) {
    this.goalContainer.classList.toggle('hidden', mode !== 'freestyle')
    this.description.textContent = MODE_DESCRIPTIONS[mode]
  }
}

export default WorkoutModeDialog
