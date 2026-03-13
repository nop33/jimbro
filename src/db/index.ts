import { exercisesStore } from './stores/exercisesStore'
import { programsStore } from './stores/programsStore'

export const db = {
  exercises: exercisesStore,
  programs: programsStore
}
