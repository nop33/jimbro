import '../../style.css'
import ExercisesState from '../../state/ExercisesState'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

await ExercisesState.initialize()
ExerciseList.init()
ExerciseDialog.init()
