import ExercisesState from '../../state/ExercisesState'
import ProgramsState from '../../state/ProgramsState'
import '../../style.css'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

await ProgramsState.initialize()
await ProgramList.init()

await ExercisesState.initialize()
ProgramDialog.init()
