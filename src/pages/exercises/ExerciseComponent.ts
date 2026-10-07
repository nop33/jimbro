import { EXERCISE_KIND_LABELS, formatPrescription } from '../../db/exerciseLogging'
import { muscleGroupLabel } from '../../db/muscleGroups'
import type { Exercise } from '../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../utils'

class ExerciseComponent {
  private exercise: Exercise
  private onClick?: (exercise: Exercise) => void

  // Without onClick, as in a program's exercise list, the card does nothing on a click.
  constructor(exercise: Exercise, onClick?: (exercise: Exercise) => void) {
    this.exercise = exercise
    this.onClick = onClick
  }

  render() {
    const exerciseItem = nodeFromTemplate('#exercise-item-template')

    setTextContent('.exercise-name', this.exercise.name, exerciseItem)
    const { kind, muscle } = this.exercise
    const kindLabel = EXERCISE_KIND_LABELS[kind]

    setTextContent('.exercise-muscle', muscle ? muscleGroupLabel(muscle) : kindLabel, exerciseItem)
    setTextContent('.exercise-prescription', formatPrescription(this.exercise), exerciseItem)

    const kindBadge = exerciseItem.querySelector('.exercise-kind') as HTMLSpanElement | null
    if (kindBadge && muscle && kind !== 'lifting') {
      kindBadge.textContent = kindLabel
      kindBadge.classList.remove('hidden')
    }

    const { onClick } = this
    if (onClick) exerciseItem.querySelector('div')?.addEventListener('click', () => onClick(this.exercise))

    return exerciseItem
  }
}

export default ExerciseComponent
