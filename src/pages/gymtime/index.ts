import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseList from '../exercises/ExerciseList'
import AddExerciseDialog from './AddExerciseDialog'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'

// The page works without the wake lock, so it doesn't wait for it.
void keepScreenAwake()
await exercisesStore.load()

EditSetDialog.init()
BreakTimerDialog.init()
ExerciseList.init((exercise) => AddExerciseDialog.pick(exercise))
ExerciseHistoryChart.init()
LastSetDialog.init()
GymtimePage.start()
