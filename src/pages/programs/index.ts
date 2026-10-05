import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import '../../style.css'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

await programsStore.load()
await exercisesStore.load()
ProgramList.init()
ProgramDialog.init()
