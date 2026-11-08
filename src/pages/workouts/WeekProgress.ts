import type { WorkoutModeSettings } from '../../settings'
import { setTextContent } from '../../utils'
import { carryNote, fillGoalBar } from '../goalBar'

// This week's progress toward the goal, under the mode that sets it. The card opens the mode dialog, so the mode
// sits next to the count it decides. The goal bar is the home page's week card's.
// Workouts done ahead last week count toward the goal, and those beyond it toward next week.
const renderWeekProgress = ({
  completed,
  ahead,
  extra,
  goal,
  settings
}: {
  completed: number
  ahead: number
  extra: number
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
  const counted = completed + ahead
  setTextContent(
    '#week-progress-count',
    `${Math.min(counted, goal)} of ${goal} ${rotation ? 'programs' : 'workouts'} done`,
    card
  )

  const left = goal - counted
  const carry = carryNote({ ahead, extra })
  setTextContent(
    '#week-progress-note',
    left <= 0
      ? extra > 0
        ? `All done this week, ${carry}! 💪`
        : 'All done this week! 💪'
      : counted === 0
        ? 'Time to get sweating! 💦'
        : `${left} ${left === 1 ? 'workout' : 'workouts'} left this week${ahead > 0 ? `, ${carry}` : ''}.`,
    card
  )

  fillGoalBar(card.querySelector('#week-progress-goal') as HTMLSpanElement, { goal, completed, ahead, extra })
  card.hidden = false
}

export default renderWeekProgress
