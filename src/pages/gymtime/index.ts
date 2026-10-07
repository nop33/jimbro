import '../../style.css'
import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseList from '../exercises/ExerciseList'
import AddExerciseDialog from './AddExerciseDialog'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'

keepScreenAwake()
await exercisesStore.load()

EditSetDialog.init()
BreakTimerDialog.init()
ExerciseList.init((exercise) => AddExerciseDialog.pick(exercise))
ExerciseHistoryChart.init()
LastSetDialog.init()
GymtimePage.start()
