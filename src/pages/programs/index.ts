import { exercises } from '../../db/stores/exercisesStore'
import { programs } from '../../db/stores/programsStore'
import '../../style.css'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

await programs.initialize()
await exercises.initialize()
ProgramList.init()
ProgramDialog.init()
