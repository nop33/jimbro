import { db } from '../../db'
import type { Exercise } from '../../db/stores/exercisesStore'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import ExerciseCard from './ExerciseCard'

class ExerciseCardList {
  private static exercisesList: HTMLDivElement
  private static exerciseDefinitions = new Map<string, Exercise>()
  private static programId: string
  private static programExerciseIds: string[]

  static init(programId: string, programExerciseIds: string[]) {
    this.exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
    this.programId = programId
    this.programExerciseIds = programExerciseIds
  }

  static setProgramExerciseIds(programExerciseIds: string[]) {
    this.programExerciseIds = programExerciseIds
  }

  static async render() {
    const scrollY = window.scrollY
    const openExerciseId = document.querySelector<HTMLDetailsElement>('.exercise-details[open]')
      ?.closest<HTMLDivElement>('[data-exercise-id]')
      ?.dataset.exerciseId

    this.exercisesList.innerHTML = ''
    this.exerciseDefinitions.clear()

    const session = GymtimeSessionState.session
    let exerciseIds: Exercise['id'][] = this.programExerciseIds

    if (session) {
      exerciseIds = session.exercises.map(({ exerciseId }) => exerciseId)
    }

    for (const exerciseId of exerciseIds) {
      const exercise = await db.exercises.getById(exerciseId)
      if (!exercise) continue

      this.exerciseDefinitions.set(exerciseId, exercise)
      const card = await new ExerciseCard({
        exercise,
        programId: this.programId,
        programExerciseIds: this.programExerciseIds,
        exerciseDefinitions: this.exerciseDefinitions,
        onExerciseDeleted: () => this.render()
      }).render()
      this.exercisesList.appendChild(card)
    }

    if (openExerciseId) {
      this.exercisesList
        .querySelector<HTMLDetailsElement>(`[data-exercise-id="${openExerciseId}"] .exercise-details`)
        ?.setAttribute('open', '')
    }

    window.scrollTo(0, scrollY)
  }
}

export default ExerciseCardList
