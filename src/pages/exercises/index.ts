import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import '../../style.css'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

exercisesStore.initialize()

ExerciseList.init()
ExerciseDialog.init()

window.addEventListener('exercise-clicked', (e) => {
  const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
  ExerciseDialog.render(exercise)
  ExerciseDialog.openDialog()
})
