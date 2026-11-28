import { exercisesStore } from '../../db/stores/exercisesStore'
import GymtimePage from './GymtimePage'

export const mount = async (signal: AbortSignal) => {
  await exercisesStore.load()
  await new GymtimePage(signal).start()
}
