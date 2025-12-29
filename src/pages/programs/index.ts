import { exercisesStore } from '../../db/stores/exercisesStore';
import { programsStore } from '../../db/stores/programsStore';
import '../../style.css';
import ProgramDialog from './ProgramDialog';
import ProgramList from './ProgramList';

await programsStore.initialize()
ProgramList.init()

await exercisesStore.initialize()
ProgramDialog.init()
