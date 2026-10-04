import { exercises } from './stores/exercisesStore'
import { programsStore } from './stores/programsStore'

export const db = {
  exercises,
  programs: programsStore
}
