import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

export const mount = async (signal: AbortSignal) => {
  await exercisesStore.load()
  const dialog = new ExerciseDialog()
  new ExerciseList((exercise) => dialog.open(exercise), signal)
}
