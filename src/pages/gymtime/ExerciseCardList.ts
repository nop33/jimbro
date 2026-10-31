import { catalogSnapshots, type PlannedSession } from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'
import ExerciseCard, { type CardActions } from './ExerciseCard'
import { keptLastTimes, planExercise, type ExercisePlan } from './exercisePlan'

// The view of the open session: one card per exercise, kept for as long as the exercise is shown. Each session the
// page shows reaches every card through ExerciseCard.show, whatever changed it.
class ExerciseCardList {
  private exercisesList = document.querySelector('#exercises-list') as HTMLDivElement
  private actions: CardActions
  private programExerciseIds: string[]
  private planned: () => PlannedSession
  private cards = new Map<ExerciseSnapshot['exerciseId'], ExerciseCard>()
  private lastTimes = keptLastTimes()
  private generation = 0
  private latest: Promise<void> = Promise.resolve()

  // planned tells where the workout will be done, for the cards shown before it starts.
  constructor(actions: CardActions, programExerciseIds: string[], planned: () => PlannedSession) {
    this.actions = actions
    this.programExerciseIds = programExerciseIds
    this.planned = planned
    actions.session.busyOn(this.exercisesList)
    actions.session.subscribe((session) => this.show(session))
  }

  setProgramExerciseIds(programExerciseIds: string[]) {
    this.programExerciseIds = programExerciseIds
  }

  // The cards before the start show what it will store for the new day or gym.
  async replan(): Promise<void> {
    if (!this.actions.session.current) await this.show(undefined)
  }

  // Resolves once the cards show the session, or a later one, and a set just logged has drawn its border.
  private show(session: WorkoutSession | undefined): Promise<void> {
    const shown = this.draw(session, ++this.generation)
    this.latest = shown
    return shown
  }

  private async draw(session: WorkoutSession | undefined, generation: number): Promise<void> {
    const planned = this.planned()
    // Before the start, the cards show the exercises the start will store.
    const snapshots = session ? session.exercises : await catalogSnapshots(this.programExerciseIds)

    const plans = await Promise.all(
      snapshots.map(
        async (snapshot): Promise<[ExerciseSnapshot, ExercisePlan]> => [
          snapshot,
          await planExercise(snapshot, session ?? planned, this.lastTimes)
        ]
      )
    )

    // A later session is on its way to the screen.
    if (generation !== this.generation) return this.latest

    // Everything from here runs in one task, so a tap or scroll can't land between the cards' changes.
    const scrollY = window.scrollY
    const cards = new Map<ExerciseSnapshot['exerciseId'], ExerciseCard>()
    const traced: Array<Promise<void>> = []
    for (const [snapshot, plan] of plans) {
      const card = this.cards.get(snapshot.exerciseId) ?? new ExerciseCard(snapshot, this.actions)
      traced.push(card.show(snapshot, session, plan))
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

    // A set just logged draws its border before what the change means, like the break timer, covers it.
    await Promise.all(traced)
  }
}

export default ExerciseCardList
