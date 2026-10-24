import { exercisesStore } from '../../db/stores/exercisesStore'
import ExerciseList from '../exercises/ExerciseList'
import AddExerciseDialog from './AddExerciseDialog'
import EditSetDialog from './EditSetDialog'
import GymtimePage from './GymtimePage'
import { keepScreenAwake } from './keepScreenAwake'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'
import { openSession } from './openSession'
import { forgetPreparedPasskeys } from '../../sync/passkeys'
import PasskeyOfferCard from './PasskeyOfferCard'

// The break timer outlives the page, so the router wires it once for every page (router.ts).
export const mount = async (signal: AbortSignal) => {
  openSession.reset()
  signal.addEventListener('abort', () => openSession.reset())
  // The passkey offer fetches its options ahead, and keeps them fresh only while the page shows.
  signal.addEventListener('abort', forgetPreparedPasskeys)
  // The page works without the wake lock, so it doesn't wait for it.
  keepScreenAwake(signal)
  await exercisesStore.load()

  EditSetDialog.init()
  ExerciseList.init((exercise) => AddExerciseDialog.pick(exercise), signal)
  ExerciseHistoryChart.init()
  LastSetDialog.init()
  PasskeyOfferCard.init()
  await GymtimePage.start()
}
