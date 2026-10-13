import type { WorkoutModeSettings } from '../../settings'
import { setTextContent } from '../../utils'

// This week's progress toward the goal, under the mode that sets it. The card opens the mode dialog, so the mode
// sits next to the count it decides. The goal bar is the home page's week card's.
class WeekProgress {
  private static card = document.querySelector('#week-progress') as HTMLButtonElement

  static render({ completed, goal, settings }: { completed: number; goal: number; settings: WorkoutModeSettings }) {
    const rotation = settings.mode === 'rotation'
    for (const icon of this.card.querySelectorAll<SVGElement>('.mode-icon')) {
      icon.toggleAttribute('hidden', icon.dataset.mode !== settings.mode)
    }
    setTextContent('#workout-mode-name', rotation ? 'Rotation' : 'Freestyle', this.card)
    setTextContent('#workout-mode-rule', rotation ? 'Every program' : `Goal ${settings.weeklyGoal}`, this.card)
    setTextContent(
      '#week-progress-count',
      `${completed} of ${goal} ${rotation ? 'programs' : 'workouts'} done`,
      this.card
    )

    const left = goal - completed
    setTextContent(
      '#week-progress-note',
      left <= 0
        ? 'All done this week! 💪'
        : completed === 0
          ? 'Time to get sweating! 💦'
          : `${left} ${left === 1 ? 'workout' : 'workouts'} left this week.`,
      this.card
    )

    const bar = this.card.querySelector('#week-progress-goal') as HTMLSpanElement
    for (let index = 0; index < goal; index++) {
      const segment = document.createElement('span')
      if (index < completed) segment.classList.add('met')
      bar.appendChild(segment)
    }
    this.card.hidden = false
  }
}

export default WeekProgress
