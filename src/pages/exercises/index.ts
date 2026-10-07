import '../../style.css'
import { exercises } from '../../db/stores/exercisesStore'
import ExerciseDialog from './ExerciseDialog'
import ExerciseList from './ExerciseList'

await exercises.initialize()
ExerciseList.init()
ExerciseDialog.init()
