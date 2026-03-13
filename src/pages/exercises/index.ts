import '../../style.css'
import type { Exercise } from '../../db/stores/exercisesStore'
import ExercisesState from '../../state/ExercisesState'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

await ExercisesState.initialize()

ExerciseList.init()
ExerciseDialog.init()

window.addEventListener('exercise-clicked', (e) => {
  const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
  ExerciseDialog.render(exercise)
  ExerciseDialog.openDialog()
})
