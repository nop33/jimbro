import '../../style.css'
import ExercisesState from '../../state/ExercisesState'
import ExerciseList from '../exercises/ExerciseList'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'

keepScreenAwake()
await ExercisesState.initialize()

EditSetDialog.init()
BreakTimerDialog.init()
ExerciseList.init()
ExerciseHistoryChart.init()
LastSetDialog.init()
GymtimePage.start()
