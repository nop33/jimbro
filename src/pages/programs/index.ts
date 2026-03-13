import { programsStore } from '../../db/stores/programsStore'
import ExercisesState from '../../state/ExercisesState'
import '../../style.css'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

await programsStore.initialize()
await ProgramList.init()

await ExercisesState.initialize()
ProgramDialog.init()
