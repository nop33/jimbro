import { exercisesStore } from '../../db/stores/exercisesStore';
import '../../style.css';
import ProgramDialog from './ProgramDialog';
import ProgramList from './ProgramList';

const exercises = await exercisesStore.getAllExercises()

ProgramList.init()
ProgramDialog.init({ exercises, onProgramSaved: () => { ProgramList.reload() } })
