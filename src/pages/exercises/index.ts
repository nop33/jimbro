import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

await exercisesStore.load()
ExerciseList.init((exercise) => {
  ExerciseDialog.populateForm(exercise)
  ExerciseDialog.openDialog()
})
ExerciseDialog.init()
