import '../../style.css'
import { exercises } from '../../db/stores/exercisesStore'
import ExerciseList from '../exercises/ExerciseList'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'

keepScreenAwake()
await exercises.initialize()

EditSetDialog.init()
BreakTimerDialog.init()
ExerciseList.init()
ExerciseHistoryChart.init()
LastSetDialog.init()
GymtimePage.start()
