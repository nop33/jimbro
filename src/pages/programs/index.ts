import { exercises } from '../../db/stores/exercisesStore'
import ProgramsState from '../../state/ProgramsState'
import '../../style.css'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

await ProgramsState.initialize()
await exercises.initialize()
ProgramList.init()
ProgramDialog.init()
