import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import ProgramDialog from './ProgramDialog'
import ProgramList from './ProgramList'

export const mount = async (signal: AbortSignal) => {
  await programsStore.load()
  await exercisesStore.load()
  ProgramList.init(signal)
  ProgramDialog.init()
}
