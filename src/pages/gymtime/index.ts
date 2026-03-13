import '../../style.css'
import ExercisesState from '../../state/ExercisesState'
import ExerciseList from '../exercises/ExerciseList'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'

keepScreenAwake()
EditSetDialog.init()
BreakTimerDialog.init()
ExercisesState.initialize()
ExerciseList.init()

GymtimePage.start()
