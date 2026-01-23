import type { Exercise } from '../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../utils'

class ExerciseComponent {
  private exercise: Exercise

  constructor(exercise: Exercise) {
    this.exercise = exercise
  }

  render() {
    const exerciseItem = nodeFromTemplate('#exercise-item-template')

    setTextContent('.exercise-name', this.exercise.name, exerciseItem)
    setTextContent('.exercise-muscle', this.exercise.muscle, exerciseItem)
    setTextContent('.exercise-sets', this.exercise.sets.toString(), exerciseItem)
    setTextContent('.exercise-reps', this.exercise.reps.toString(), exerciseItem)

    exerciseItem.querySelector('div')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('exercise-clicked', { detail: { exercise: this.exercise } }))
    })

    return exerciseItem
  }
}

export default ExerciseComponent
