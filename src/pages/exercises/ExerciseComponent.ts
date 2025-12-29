import type { Exercise } from "../../db/stores/exercisesStore"
import { nodeFromTemplate, setTextContent } from "../../utils"
import ExerciseDialog from "./ExerciseDialog"

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
      ExerciseDialog.render(this.exercise)
      ExerciseDialog.openDialog()
    })

    return exerciseItem
  }
}

export default ExerciseComponent
