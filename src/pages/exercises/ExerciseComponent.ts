import { EXERCISE_KIND_LABELS, formatPrescription } from '../../db/exerciseLogging'
import { muscleGroupLabel, type Exercise } from '../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../utils'

class ExerciseComponent {
  private exercise: Exercise

  constructor(exercise: Exercise) {
    this.exercise = exercise
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

    exerciseItem.querySelector('div')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('exercise-clicked', { detail: { exercise: this.exercise } }))
    })

    return exerciseItem
  }
}

export default ExerciseComponent
