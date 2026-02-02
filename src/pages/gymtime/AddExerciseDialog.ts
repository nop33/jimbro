import Dialog from '../../components/Dialog'
import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import ExerciseList from '../exercises/components/ExerciseList'

class AddExerciseDialog extends Dialog {
  constructor(dialogIdSelector: string) {
    super(dialogIdSelector)
  }

  async init(handleExerciseClicked: (exercise: Exercise) => void) {
    await exercisesStore.initialize()
    const exerciseList = new ExerciseList('#exercises-grid', handleExerciseClicked)
    await exerciseList.init()
  }
}

export default AddExerciseDialog
