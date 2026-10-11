import {
  breakTimerEnabled,
  emptySet,
  historyChartEnabled,
  EXERCISE_KIND_LABELS,
  setValues,
  type ExerciseSetExecution
} from '../../db/exerciseLogging'
import { muscleGroupLabel } from '../../db/muscleGroups'
import {
  nextUnfinished,
  progressOf,
  workoutSessionsStore,
  type ExerciseProgress
} from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'
import { throwConfetti } from '../../features/confetti'
import { getBreakTimeSeconds } from '../../settings'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { animateDetails, type AnimateDetailsHandle } from './animateDetails'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import AddExerciseDialog from './AddExerciseDialog'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'
import { alertIfInSession, openSession } from './openSession'
import type { ExercisePlan } from './exercisePlan'
import { clearSetNotes, configureSetRowGrid, readSetFromForm, renderSetFields, renderSetInputs } from './setSlots'

// Room the actions menu needs below its button: four 48px items and a margin.
const MENU_ROOM = 220

// One row of the card's set list: a logged set, or a slot still to do.
interface SetRow {
  set: ExerciseSetExecution
  logged: boolean
}

// One exercise's card. The card list builds it once per exercise and calls show with each session the page shows, so
// the card keeps what the user is doing in it: open or closed, its menu, and a value typed into the next set's form.
// Its buttons only write to the open session, which then reaches every card through show.
class ExerciseCard {
  readonly element: HTMLDivElement
  private snapshot: ExerciseSnapshot
  private plan: ExercisePlan | undefined
  private readonly details: HTMLDetailsElement
  private readonly detailsAnimation: AnimateDetailsHandle
  private readonly completedSets: HTMLDivElement
  private readonly nextSetDiv: HTMLDivElement
  private readonly nextSetForm: HTMLFormElement
  private readonly nextSetFields: HTMLDivElement
  private readonly submitButton: HTMLButtonElement
  private readonly actionsBtn: HTMLButtonElement
  private readonly viewHistoryBtn: HTMLButtonElement
  private readonly viewLastSetBtn: HTMLButtonElement
  // What the next set's inputs were last filled with, and whether the user has typed in them since.
  private filledWith = ''
  private typedIn = false

  constructor(snapshot: ExerciseSnapshot) {
    this.snapshot = snapshot
    const template = nodeFromTemplate('#workout-exercise-item-template')
    this.element = template.querySelector('div') as HTMLDivElement
    this.details = this.element.querySelector('.exercise-details') as HTMLDetailsElement
    this.completedSets = this.details.querySelector('.completed-sets') as HTMLDivElement
    this.nextSetDiv = this.element.querySelector('.next-set') as HTMLDivElement
    this.nextSetForm = this.nextSetDiv.querySelector('.next-set-form') as HTMLFormElement
    this.nextSetFields = this.nextSetForm.querySelector('.next-set-fields') as HTMLDivElement
    this.submitButton = this.nextSetForm.querySelector('button[type="submit"]') as HTMLButtonElement
    this.actionsBtn = this.element.querySelector('.exercise-actions-btn') as HTMLButtonElement
    this.viewHistoryBtn = this.element.querySelector('.view-history-btn') as HTMLButtonElement
    this.viewLastSetBtn = this.element.querySelector('.view-last-set-btn') as HTMLButtonElement

    this.element.setAttribute('data-exercise-id', this.exerciseId)
    this.detailsAnimation = animateDetails(
      this.details,
      this.details.querySelector('.exercise-details-content') as HTMLDivElement,
      { accordionSelector: '.exercise-details' }
    )

    this.setUpActionsMenu()
    this.setUpNextSetForm()

    this.viewHistoryBtn.addEventListener('click', () => {
      void ExerciseHistoryChart.openDialog({ id: this.exerciseId, name: this.snapshot.name, kind: this.snapshot.kind })
    })
    this.viewLastSetBtn.addEventListener('click', () => {
      const lastTime = this.plan?.lastTime
      if (lastTime) void LastSetDialog.openDialog(lastTime.sets, lastTime.date, lastTime.location)
    })
  }

  private get exerciseId(): string {
    return this.snapshot.exerciseId
  }

  // Shows the exercise as the session holds it, or before a session starts, as the start will store it. It changes
  // only what differs from what the card shows, and leaves the next set's inputs alone while the user is on them.
  show(snapshot: ExerciseSnapshot, session: WorkoutSession | undefined, plan: ExercisePlan): void {
    const presetChanged = snapshot.preset !== this.snapshot.preset
    this.snapshot = snapshot
    this.plan = plan
    const { kind, muscle, preset } = snapshot
    const kindLabel = EXERCISE_KIND_LABELS[kind]

    setTextContent('.exercise-name', snapshot.name, this.element)
    setTextContent('.exercise-muscle', muscle ? muscleGroupLabel(muscle) : kindLabel, this.element)
    const kindBadge = this.element.querySelector('.exercise-kind') as HTMLSpanElement
    kindBadge.textContent = kindLabel
    kindBadge.classList.toggle('hidden', !muscle || kind === 'lifting')
    this.actionsBtn.setAttribute('aria-label', `Actions for ${snapshot.name}`)

    const { progress } = plan
    this.element.classList.toggle('card-success', progress.done)
    this.nextSetDiv.classList.toggle('hidden', progress.done)
    this.submitButton.classList.toggle('hidden', !session)
    this.viewHistoryBtn.classList.toggle('hidden', !historyChartEnabled(kind))
    this.viewLastSetBtn.classList.toggle('hidden', !plan.lastTime)

    configureSetRowGrid(this.completedSets, preset)
    const logged = session?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)?.sets ?? []
    this.showSetRows(
      Array.from({ length: progress.target }, (_, index) =>
        index < logged.length ? { set: logged[index], logged: true } : { set: emptySet(preset), logged: false }
      )
    )

    const notes = plan.prefillIsMax ? { weight: 'Max last time' } : {}
    const fillWith = JSON.stringify([preset, plan.prefill, notes])
    const onInputs = this.typedIn || this.nextSetForm.contains(document.activeElement)
    if (presetChanged || (fillWith !== this.filledWith && !onInputs)) {
      renderSetInputs(this.nextSetFields, preset, plan.prefill, notes)
      this.filledWith = fillWith
      this.typedIn = false
    }
  }

  // Keeps each row that still shows the same set, so only a changed row is drawn again.
  private showSetRows(rows: Array<SetRow>) {
    rows.forEach((row, index) => {
      const key = JSON.stringify(row)
      const shown = this.completedSets.children.item(index) as HTMLDivElement | null
      if (shown?.dataset.row === key) return
      const item = this.renderSetItem(row, index)
      item.dataset.row = key
      if (shown) shown.replaceWith(item)
      else this.completedSets.append(item)
    })
    while (this.completedSets.children.length > rows.length) this.completedSets.lastElementChild?.remove()
  }

  private renderSetItem({ set, logged }: SetRow, index: number): HTMLDivElement {
    const template = nodeFromTemplate('#completed-set-item-template')
    const div = template.querySelector('div') as HTMLDivElement
    const setNumber = (index + 1).toString()

    setTextContent('.set-number', setNumber, template)
    renderSetFields(template.querySelector('.set-fields') as HTMLDivElement, set)

    div.classList.add(logged ? 'isCompleted' : 'isPending')
    div.setAttribute('data-set-number', setNumber)

    if (logged) {
      div.addEventListener('click', () => {
        if (!openSession.current) throw new Error('No existing workout session found')
        EditSetDialog.openDialog({ set, exerciseId: this.exerciseId, index })
      })
    }

    return div
  }

  // The exercise's progress in the session, which the store's status and the card both go by.
  private progressIn(session: WorkoutSession): ExerciseProgress | undefined {
    const exercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)
    return exercise && progressOf(exercise)
  }

  private setUpActionsMenu() {
    const { actionsBtn } = this
    const actionsMenu = this.element.querySelector('.exercise-actions-menu') as HTMLDivElement
    const deleteBtn = actionsMenu.querySelector('.delete-workout-session-exercise-btn') as HTMLButtonElement
    const swapBtn = actionsMenu.querySelector('.swap-workout-session-exercise-btn') as HTMLButtonElement
    const moveUpBtn = actionsMenu.querySelector('.move-up-workout-session-exercise-btn') as HTMLButtonElement
    const moveDownBtn = actionsMenu.querySelector('.move-down-workout-session-exercise-btn') as HTMLButtonElement

    // A popover gives light dismiss (outside tap, Esc) and the button's aria-expanded for free.
    // Script places it, since CSS anchor positioning is missing from older iOS versions.
    actionsBtn.popoverTargetElement = actionsMenu

    // Under the button, or above it when the menu's four items wouldn't fit below.
    const placeMenu = () => {
      const button = actionsBtn.getBoundingClientRect()
      const opensUp = window.innerHeight - button.bottom < MENU_ROOM
      actionsMenu.style.top = opensUp ? 'auto' : `${button.bottom + 4}px`
      actionsMenu.style.bottom = opensUp ? `${window.innerHeight - button.top + 4}px` : 'auto'
      actionsMenu.style.right = `${document.documentElement.clientWidth - button.right}px`
    }

    let followScroll: AbortController | undefined
    actionsMenu.addEventListener('beforetoggle', (event) => {
      if (event.newState !== 'open') return

      // A finished exercise keeps its sets: it can move, but not be swapped or deleted.
      const session = openSession.current
      const completed = (session && this.progressIn(session)?.done) ?? false
      swapBtn.classList.toggle('hidden', completed)
      deleteBtn.classList.toggle('hidden', completed)

      const exercises = session?.exercises ?? []
      const exerciseIndex = exercises.findIndex(({ exerciseId }) => exerciseId === this.exerciseId)
      moveUpBtn.classList.toggle('hidden', exerciseIndex <= 0)
      moveDownBtn.classList.toggle('hidden', exerciseIndex === -1 || exerciseIndex === exercises.length - 1)

      placeMenu()
    })

    // The menu follows its button while the page scrolls. Capture catches a scroll in any container.
    actionsMenu.addEventListener('toggle', (event) => {
      followScroll?.abort()
      if (event.newState !== 'open') return

      followScroll = new AbortController()
      const { signal } = followScroll
      // Removing the card removes the menu without a toggle event, so the listener drops itself then.
      const follow = () => (actionsMenu.isConnected ? placeMenu() : followScroll?.abort())
      document.addEventListener('scroll', follow, { capture: true, passive: true, signal })
    })

    for (const item of [moveUpBtn, moveDownBtn, swapBtn, deleteBtn]) {
      item.addEventListener('click', () => actionsMenu.hidePopover())
    }

    moveUpBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'up'))
    })

    moveDownBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'down'))
    })

    deleteBtn.addEventListener('click', async () => {
      const session = openSession.current
      if (!session) {
        alert('Start a workout session first')
        return
      }

      const hasSets = (this.progressIn(session)?.logged ?? 0) > 0
      const question = hasSets
        ? 'This exercise already has completed sets. Deleting it will result in lost progress. Are you sure?'
        : 'Are you sure you want to delete this exercise from the workout session?'
      if (!confirm(question)) return

      await openSession.apply((session) => workoutSessionsStore.removeExercise(session, this.exerciseId))
    })

    swapBtn.addEventListener('click', () => {
      const session = openSession.current
      if (!session) {
        alert('Start a workout session first')
        return
      }

      if (
        (this.progressIn(session)?.logged ?? 0) > 0 &&
        !confirm(
          'This exercise already has completed sets. Swapping it will result in lost progress. Are you sure you want to proceed?'
        )
      )
        return

      AddExerciseDialog.openDialog({
        title: 'Swap exercise',
        onExerciseClicked: async (newExercise) => {
          if (newExercise.id === this.exerciseId || alertIfInSession(newExercise.id)) return
          await openSession.apply((session) => workoutSessionsStore.swapExercise(session, this.exerciseId, newExercise))
        }
      })
    })
  }

  private setUpNextSetForm() {
    const { nextSetForm } = this
    const addExtraSetBtn = this.element.querySelector('.add-extra-set-btn') as HTMLButtonElement

    nextSetForm.addEventListener('input', () => {
      this.typedIn = true
    })

    // The session stores the extra set, so the workout is not done until it is logged.
    addExtraSetBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      await openSession.apply((session) => workoutSessionsStore.addSetSlot(session, this.exerciseId))
    })

    nextSetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const { preset } = this.snapshot
      const completedSet = readSetFromForm(nextSetForm, preset)
      const values = setValues(completedSet)

      if (values.reps === 0 || (completedSet.preset === 'lifting' && completedSet.weight === 0)) {
        if (!confirm(`Are you sure you want to submit a set with 0 ${values.reps === 0 ? 'reps' : 'weight'}?`)) return
      }

      const updated = await openSession.apply((session) =>
        workoutSessionsStore.addSet(session, this.exerciseId, completedSet)
      )
      const progress = this.progressIn(updated)
      if (!progress) return

      // The form keeps the set just logged as the next one's values, which are no longer last time's max, and which
      // the next session shown may fill in again.
      clearSetNotes(this.nextSetFields)
      this.typedIn = false

      if (progress.done) this.detailsAnimation.close()

      // openSession celebrates the set that finishes the workout.
      if (updated.status === 'completed') return

      if (progress.done) {
        navigator.vibrate?.([50, 30, 50, 30, 70])
        BreakTimerDialog.closeDialog()
        throwConfetti('Exercise done!')
        return
      }

      if (breakTimerEnabled(preset)) {
        const breakTimeSeconds = getBreakTimeSeconds()
        BreakTimerDialog.startTimer({
          minutes: Math.floor(breakTimeSeconds / 60),
          seconds: breakTimeSeconds % 60,
          setsDone: progress.logged,
          setsTotal: progress.target,
          nextExercise: nextUnfinished(updated, this.exerciseId)?.name,
          currentExercise: { id: this.exerciseId, name: this.snapshot.name, kind: this.snapshot.kind }
        })
      }
    })
  }
}

export default ExerciseCard
