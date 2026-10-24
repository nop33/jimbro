import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

export const mount = async (signal: AbortSignal) => {
  await exercisesStore.load()
  ExerciseList.init((exercise) => {
    ExerciseDialog.populateForm(exercise)
    ExerciseDialog.openDialog()
  }, signal)
  ExerciseDialog.init()
}
