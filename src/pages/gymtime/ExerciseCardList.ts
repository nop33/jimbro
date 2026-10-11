import { exercisesStore } from '../../db/stores/exercisesStore'
import { snapshotFromExercise, type PlannedSession } from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'
import ExerciseCard from './ExerciseCard'
import { keptLastTimes, planExercise, type ExercisePlan } from './exercisePlan'
import { openSession } from './openSession'

// The view of the open session: one card per exercise, kept for as long as the exercise is shown. Each session the
// page shows reaches every card through ExerciseCard.show, whatever changed it.
class ExerciseCardList {
  private static exercisesList: HTMLDivElement
  private static programExerciseIds: string[]
  private static planned: () => PlannedSession
  private static cards = new Map<ExerciseSnapshot['exerciseId'], ExerciseCard>()
  private static lastTimes = keptLastTimes()
  private static generation = 0
  private static latest: Promise<void> = Promise.resolve()

  // planned tells where the workout will be done, for the cards shown before it starts.
  static init(programExerciseIds: string[], planned: () => PlannedSession) {
    this.exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
    this.programExerciseIds = programExerciseIds
    this.planned = planned
    openSession.busyOn(this.exercisesList)
    openSession.subscribe((session) => this.show(session))
  }

  static setProgramExerciseIds(programExerciseIds: string[]) {
    this.programExerciseIds = programExerciseIds
  }

  // The cards before the start show what it will store for the new day or gym.
  static async replan(): Promise<void> {
    if (!openSession.current) await this.show(undefined)
  }

  // A pull or another tab may have changed an earlier workout, so the cards read last time again.
  static forgetLastTimes() {
    this.lastTimes.forget()
  }

  // Resolves once the cards show the session, or a later one.
  private static show(session: WorkoutSession | undefined): Promise<void> {
    const shown = this.draw(session, ++this.generation)
    this.latest = shown
    return shown
  }

  private static async draw(session: WorkoutSession | undefined, generation: number): Promise<void> {
    const planned = this.planned()
    const exerciseIds = session ? session.exercises.map(({ exerciseId }) => exerciseId) : this.programExerciseIds

    const plans = await Promise.all(
      exerciseIds.map(async (exerciseId): Promise<[ExerciseSnapshot, ExercisePlan] | undefined> => {
        const snapshot =
          session?.exercises.find((e) => e.exerciseId === exerciseId) ?? (await catalogSnapshot(exerciseId))
        if (!snapshot) return undefined
        return [snapshot, await planExercise(snapshot, session ?? planned, this.lastTimes.read)]
      })
    )

    // A later session is on its way to the screen.
    if (generation !== this.generation) return this.latest

    // Everything from here runs in one task, so a tap or scroll can't land between the cards' changes.
    const scrollY = window.scrollY
    const cards = new Map<ExerciseSnapshot['exerciseId'], ExerciseCard>()
    for (const [snapshot, plan] of plans.filter((shown) => shown !== undefined)) {
      const card = this.cards.get(snapshot.exerciseId) ?? new ExerciseCard(snapshot)
      card.show(snapshot, session, plan)
      cards.set(snapshot.exerciseId, card)
    }
    this.cards = cards

    // Moves only the cards out of place, since a card taken out of the page loses the focus in it.
    const elements = [...cards.values()].map(({ element }) => element)
    elements.forEach((element, index) => {
      const at = this.exercisesList.children.item(index)
      if (at !== element) this.exercisesList.insertBefore(element, at)
    })
    while (this.exercisesList.children.length > elements.length) this.exercisesList.lastElementChild?.remove()

    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY)
  }
}

// Before a session starts, the card shows the exercise as the catalog has it.
const catalogSnapshot = async (exerciseId: string): Promise<ExerciseSnapshot | undefined> => {
  const exercise = await exercisesStore.getById(exerciseId)
  return exercise && snapshotFromExercise(exercise)
}

export default ExerciseCardList
