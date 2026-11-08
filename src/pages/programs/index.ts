import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import NewProgramDialog from './NewProgramDialog'
import ProgramList from './ProgramList'

export const mount = async (signal: AbortSignal) => {
  await Promise.all([programsStore.load(), exercisesStore.load()])
  new NewProgramDialog()
  new ProgramList(signal)
}
