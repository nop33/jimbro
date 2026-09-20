import { db } from '../../db'
import { snapshotFromExercise, type ExerciseSnapshot } from '../../db/stores/workoutSessionsStore'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import ExerciseCard from './ExerciseCard'

class ExerciseCardList {
  private static exercisesList: HTMLDivElement
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
    const cards: DocumentFragment[] = []

    for (const exerciseId of exerciseIds) {
      if (generation !== this.renderGeneration) return

      const execution = session?.exercises.find((e) => e.exerciseId === exerciseId)
      let snapshot: ExerciseSnapshot | undefined = execution

      if (!snapshot) {
        const catalog = await db.exercises.getById(exerciseId)
        snapshot = catalog && snapshotFromExercise(catalog)
      }

      if (!snapshot) continue

      cards.push(
        await new ExerciseCard({
          snapshot,
          programId: this.programId,
          programExerciseIds: this.programExerciseIds,
          onExerciseDeleted: () => {
            void this.render()
          }
        }).render()
      )
    }

    if (generation !== this.renderGeneration) return

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
