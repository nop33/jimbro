import type { WorkoutModeSettings } from '../../settings'
import { setTextContent } from '../../utils'

// This week's progress toward the goal, under the mode that sets it. The card opens the mode dialog, so the mode
// sits next to the count it decides. The goal bar is the home page's week card's.
const renderWeekProgress = ({
  completed,
  goal,
  settings
}: {
  completed: number
  goal: number
  settings: WorkoutModeSettings
}) => {
  const card = document.querySelector('#week-progress') as HTMLButtonElement
  const rotation = settings.mode === 'rotation'
  for (const icon of card.querySelectorAll<SVGElement>('.mode-icon')) {
    icon.toggleAttribute('hidden', icon.dataset.mode !== settings.mode)
  }
  setTextContent('#workout-mode-name', rotation ? 'Rotation' : 'Freestyle', card)
  setTextContent('#workout-mode-rule', rotation ? 'Every program' : `Goal ${settings.weeklyGoal}`, card)
  setTextContent('#week-progress-count', `${completed} of ${goal} ${rotation ? 'programs' : 'workouts'} done`, card)

  const left = goal - completed
  setTextContent(
    '#week-progress-note',
    left <= 0
      ? 'All done this week! 💪'
      : completed === 0
        ? 'Time to get sweating! 💦'
        : `${left} ${left === 1 ? 'workout' : 'workouts'} left this week.`,
    card
  )

  const bar = card.querySelector('#week-progress-goal') as HTMLSpanElement
  for (let index = 0; index < goal; index++) {
    const segment = document.createElement('span')
    if (index < completed) segment.classList.add('met')
    bar.appendChild(segment)
  }
  card.hidden = false
}

export default renderWeekProgress
