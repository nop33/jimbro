import { db } from '../../db'
import type { Exercise } from '../../db/stores/exercisesStore'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import ExerciseCard from './ExerciseCard'

class ExerciseCardList {
  private static exercisesList: HTMLDivElement
  private static exerciseDefinitions = new Map<string, Exercise>()
  private static programId: string
  private static programExerciseIds: string[]
  private static renderGeneration = 0

  static init(programId: string, programExerciseIds: string[]) {
    this.exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
    this.programId = programId
    this.programExerciseIds = programExerciseIds
  }

  static setProgramExerciseIds(programExerciseIds: string[]) {
    this.programExerciseIds = programExerciseIds
  }

  static async render() {
    const generation = ++this.renderGeneration
    const scrollY = window.scrollY
    const openExerciseId = document
      .querySelector<HTMLDetailsElement>('.exercise-details[open]')
      ?.closest<HTMLDivElement>('[data-exercise-id]')?.dataset.exerciseId

    const session = GymtimeSessionState.session
    const exerciseIds = session ? session.exercises.map(({ exerciseId }) => exerciseId) : this.programExerciseIds
    const definitions = new Map<string, Exercise>()
    const cards: DocumentFragment[] = []

    for (const exerciseId of exerciseIds) {
      if (generation !== this.renderGeneration) return

      const catalog = await db.exercises.getById(exerciseId)
      const execution = session?.exercises.find((e) => e.exerciseId === exerciseId)

      const exercise: Exercise | undefined = execution
        ? {
            id: exerciseId,
            name: execution.name,
            muscle: execution.muscle,
            targetSets: execution.targetSets,
            targetReps: execution.targetReps,
            isRehab: execution.isRehab,
            isDeleted: catalog?.isDeleted ?? true,
            updatedAt: catalog?.updatedAt ?? ''
          }
        : catalog

      if (!exercise) continue

      definitions.set(exerciseId, exercise)
      cards.push(
        await new ExerciseCard({
          exercise,
          programId: this.programId,
          programExerciseIds: this.programExerciseIds,
          exerciseDefinitions: definitions,
          onExerciseDeleted: () => {
            void this.render()
          }
        }).render()
      )
    }

    if (generation !== this.renderGeneration) return

    this.exerciseDefinitions = definitions
    this.exercisesList.replaceChildren(...cards)

    if (openExerciseId) {
      this.exercisesList
        .querySelector<HTMLDetailsElement>(`[data-exercise-id="${openExerciseId}"] .exercise-details`)
        ?.setAttribute('open', '')
    }

    window.scrollTo(0, scrollY)
  }
}

export default ExerciseCardList
