import { exercisesStore } from '../../db/stores/exercisesStore'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'

export const mount = async (signal: AbortSignal) => {
  // The page works without the wake lock, so it doesn't wait for it.
  keepScreenAwake(signal)
  await exercisesStore.load()
  await new GymtimePage(signal).start()
}
