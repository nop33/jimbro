import type { Exercise } from '../../../db/stores/exercisesStore'
import { nodeFromTemplate, requireElement, setTextContent } from '../../../utils'

class ExerciseComponent {
  private exercise: Exercise
  private handleExerciseClicked?: (exercise: Exercise) => void
  private exerciseElement: HTMLElement

  constructor(exercise: Exercise, handleExerciseClicked?: (exercise: Exercise) => void) {
    this.exercise = exercise
    this.handleExerciseClicked = handleExerciseClicked

    const exerciseItem = nodeFromTemplate('#exercise-item-template')
    this.exerciseElement = requireElement('div', exerciseItem)

    setTextContent('.exercise-name', this.exercise.name, this.exerciseElement)
    setTextContent('.exercise-muscle', this.exercise.muscle, this.exerciseElement)
    setTextContent('.exercise-sets', this.exercise.sets.toString(), this.exerciseElement)
    setTextContent('.exercise-reps', this.exercise.reps.toString(), this.exerciseElement)

    this.exerciseElement.addEventListener('click', () => this.handleExerciseClicked?.(this.exercise))
  }

  getElement() {
    return this.exerciseElement
  }

  destroy() {
    this.exerciseElement.removeEventListener('click', () => this.handleExerciseClicked?.(this.exercise))
  }
}

export default ExerciseComponent
