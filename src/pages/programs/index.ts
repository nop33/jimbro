import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

export const mount = async (signal: AbortSignal) => {
  await programsStore.load()
  await exercisesStore.load()
  const dialog = new ProgramDialog(signal)
  new ProgramList((program) => dialog.open(program), signal)
}
