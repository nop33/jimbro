import {
  emptySet,
  historyChartEnabled,
  EXERCISE_KIND_LABELS,
  setValues,
  type ExerciseSetExecution
} from '../../db/exerciseLogging'
import { muscleGroupLabel } from '../../db/muscleGroups'
import {
  canRemoveSetSlot,
  progressOf,
  workoutSessionsStore,
  type ExerciseProgress
} from '../../db/stores/workoutSessionsStore'
import type { ExerciseSnapshot, WorkoutSession } from '../../db/types'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { animateDetails, type AnimateDetailsHandle } from './animateDetails'
import EditSetDialog from './EditSetDialog'
import AddExerciseDialog from './AddExerciseDialog'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'
import { alertIfInSession, openSession } from './openSession'
import { tapToDismiss } from './tapToDismiss'
import { traceSet } from './traceSet'
import type { ExercisePlan } from './exercisePlan'
import { clearSetBadges, configureSetRowGrid, readSetFromForm, renderSetFields, renderSetInputs } from './setSlots'

// Room a menu needs below what it opens from: the actions menu's four 48px items and a margin, or the set menu's one.
const MENU_ROOM = 220
const SET_MENU_ROOM = 70

// One row of the card's set list: a logged set, or a slot still to do, which can be removed while more than one is
// left to do.
interface SetRow {
  set: ExerciseSetExecution
  logged: boolean
  removable?: boolean
}

// Places a popover menu under what it opens from, right edges lined up, or above it when room wouldn't fit below,
// and keeps it there while the page scrolls. Script places it, since CSS anchor positioning is missing from older iOS
// versions. anchor gives what the menu opens from each time it opens. A tap outside the menu only closes it.
const anchorMenu = (menu: HTMLElement, anchor: () => Element, room: number) => {
  tapToDismiss(menu)

  const place = () => {
    const box = anchor().getBoundingClientRect()
    const opensUp = window.innerHeight - box.bottom < room
    menu.style.top = opensUp ? 'auto' : `${box.bottom + 4}px`
    menu.style.bottom = opensUp ? `${window.innerHeight - box.top + 4}px` : 'auto'
    menu.style.right = `${document.documentElement.clientWidth - box.right}px`
    menu.style.transformOrigin = opensUp ? 'bottom right' : 'top right'
  }

  menu.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') place()
  })

  // Capture catches a scroll in any container.
  let followScroll: AbortController | undefined
  menu.addEventListener('toggle', (event) => {
    followScroll?.abort()
    if (event.newState !== 'open') return

    followScroll = new AbortController()
    const { signal } = followScroll
    // Removing the card removes the menu without a toggle event, so the listener drops itself then.
    const follow = () => {
      if (!menu.isConnected) followScroll?.abort()
      else if (!anchor().isConnected) menu.hidePopover()
      else place()
    }
    document.addEventListener('scroll', follow, { capture: true, passive: true, signal })
  })
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
  private readonly actionsBtn: HTMLButtonElement
  private readonly viewHistoryBtn: HTMLButtonElement
  private readonly viewLastSetBtn: HTMLButtonElement
  private readonly setMenu: HTMLDivElement
  // The row of the set to do that the set menu opened from.
  private setMenuRow: HTMLElement | undefined
  // What the next set's inputs were last filled with, and whether the user has typed in them since.
  private filledWith = ''
  private typedIn = false
  // Set while a set logged from this card's form is on its way to the screen: the card closes when it finishes the
  // exercise.
  private closeWhenDone = false

  constructor(snapshot: ExerciseSnapshot) {
    this.snapshot = snapshot
    const template = nodeFromTemplate('#workout-exercise-item-template')
    this.element = template.querySelector('div') as HTMLDivElement
    this.details = this.element.querySelector('.exercise-details') as HTMLDetailsElement
    this.completedSets = this.details.querySelector('.completed-sets') as HTMLDivElement
    this.nextSetDiv = this.element.querySelector('.next-set') as HTMLDivElement
    this.nextSetForm = this.nextSetDiv.querySelector('.next-set-form') as HTMLFormElement
    this.nextSetFields = this.nextSetForm.querySelector('.next-set-fields') as HTMLDivElement
    this.actionsBtn = this.element.querySelector('.exercise-actions-btn') as HTMLButtonElement
    this.viewHistoryBtn = this.element.querySelector('.view-history-btn') as HTMLButtonElement
    this.viewLastSetBtn = this.element.querySelector('.view-last-set-btn') as HTMLButtonElement
    this.setMenu = this.element.querySelector('.set-menu') as HTMLDivElement

    this.element.setAttribute('data-exercise-id', this.exerciseId)
    this.detailsAnimation = animateDetails(
      this.details,
      this.details.querySelector('.exercise-details-content') as HTMLDivElement,
      { accordionSelector: '.exercise-details' }
    )

    this.setUpActionsMenu()
    this.setUpSetMenu()
    this.setUpNextSetForm()

    this.viewHistoryBtn.addEventListener('click', () => {
      void ExerciseHistoryChart.openDialog({ id: this.exerciseId, name: this.snapshot.name, kind: this.snapshot.kind })
    })
    this.viewLastSetBtn.addEventListener('click', () => {
      if (this.plan?.lastTime) LastSetDialog.openDialog(this.exerciseId, this.plan.lastTime, this.plan.before)
    })
  }

  private get exerciseId(): string {
    return this.snapshot.exerciseId
  }

  // Shows the exercise as the session holds it, or before a session starts, as the start will store it. It changes
  // only what differs from what the card shows, and leaves the next set's inputs alone while the user is on them.
  // Resolves once a set just logged has drawn its border.
  show(snapshot: ExerciseSnapshot, session: WorkoutSession | undefined, plan: ExercisePlan): Promise<void> {
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
    this.viewHistoryBtn.classList.toggle('hidden', !historyChartEnabled(kind))
    this.viewLastSetBtn.classList.toggle('hidden', !plan.lastTime)

    configureSetRowGrid(this.completedSets, preset)
    const logged = session?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)?.sets ?? []
    const removable = canRemoveSetSlot(progress)
    const traced = this.showSetRows(
      Array.from({ length: progress.target }, (_, index) =>
        index < logged.length
          ? { set: logged[index], logged: true }
          : { set: emptySet(preset), logged: false, removable }
      )
    )

    const badges = plan.prefillIsMax
      ? { weight: { label: 'Max', details: `Heaviest set last time: ${plan.prefill.weight} kg` } }
      : {}
    const fillWith = JSON.stringify([preset, plan.prefill, badges])
    const onInputs = this.typedIn || this.nextSetForm.contains(document.activeElement)
    if (presetChanged || (fillWith !== this.filledWith && !onInputs)) {
      renderSetInputs(this.nextSetFields, preset, plan.prefill, badges)
      this.filledWith = fillWith
      this.typedIn = false
    }

    // The card starts closing once the set that finished the exercise has drawn its border, and keeps the next set's
    // form until the close ends, so it closes from its full height.
    const closing = progress.done && this.closeWhenDone
    return traced.then(() => {
      if (closing) this.detailsAnimation.close()
      this.detailsAnimation.afterClose(() => this.nextSetDiv.classList.toggle('hidden', this.plan?.progress.done))
    })
  }

  // Keeps each row that still shows the same set, so only a changed row is drawn again. A set to do that is now logged
  // draws its border, and the promise resolves once it has.
  private showSetRows(rows: Array<SetRow>): Promise<void> {
    const traces: Array<Promise<void>> = []
    rows.forEach((row, index) => {
      const key = JSON.stringify(row)
      const shown = this.completedSets.children.item(index) as HTMLDivElement | null
      if (shown?.dataset.row === key) return
      const item = this.renderSetItem(row, index)
      item.dataset.row = key
      if (shown) shown.replaceWith(item)
      else this.completedSets.append(item)
      if (row.logged && shown?.classList.contains('isPending')) traces.push(traceSet(item))
    })
    while (this.completedSets.children.length > rows.length) this.completedSets.lastElementChild?.remove()
    return Promise.all(traces).then(() => undefined)
  }

  private renderSetItem({ set, logged, removable }: SetRow, index: number): HTMLDivElement {
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
    } else if (removable) {
      // A row, not a button, so it keeps the set list's grid. It takes the focus and keys a button would.
      div.setAttribute('role', 'button')
      div.setAttribute('tabindex', '0')
      div.setAttribute('aria-label', `Set ${setNumber}, to do`)
      const open = () => this.openSetMenu(div, setNumber)
      div.addEventListener('click', open)
      div.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        open()
      })
    }

    return div
  }

  private openSetMenu(row: HTMLElement, setNumber: string) {
    this.setMenuRow = row
    setTextContent('.remove-set-label', `Remove set ${setNumber}`, this.setMenu)
    this.setMenu.showPopover()
    const removeBtn = this.setMenu.querySelector('.remove-set-slot-btn') as HTMLButtonElement
    removeBtn.focus()
  }

  // Every set to do is the same, so removing the one tapped takes one off the end.
  private setUpSetMenu() {
    const { setMenu } = this
    anchorMenu(setMenu, () => this.setMenuRow ?? this.completedSets, SET_MENU_ROOM)
    setMenu.addEventListener('toggle', (event) => {
      this.setMenuRow?.classList.toggle('isSelected', event.newState === 'open')
      if (event.newState === 'closed' && this.setMenuRow?.isConnected) this.setMenuRow.focus({ preventScroll: true })
    })

    const removeBtn = setMenu.querySelector('.remove-set-slot-btn') as HTMLButtonElement
    removeBtn.addEventListener('click', async () => {
      setMenu.hidePopover()
      await openSession.apply((session) => workoutSessionsStore.removeSetSlot(session, this.exerciseId))
    })
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
    actionsBtn.popoverTargetElement = actionsMenu
    anchorMenu(actionsMenu, () => actionsBtn, MENU_ROOM)

    actionsMenu.addEventListener('beforetoggle', (event) => {
      if (event.newState !== 'open') return

      // A finished exercise keeps its sets: it can move, but not be swapped or deleted.
      const session = openSession.current
      const completed = (session && this.progressIn(session)?.done) ?? false
      swapBtn.classList.toggle('hidden', completed)
      deleteBtn.classList.toggle('hidden', completed)

      const exerciseIds = openSession.exerciseIds()
      const exerciseIndex = exerciseIds.indexOf(this.exerciseId)
      moveUpBtn.classList.toggle('hidden', exerciseIndex <= 0)
      moveDownBtn.classList.toggle('hidden', exerciseIndex === -1 || exerciseIndex === exerciseIds.length - 1)
    })

    for (const item of [moveUpBtn, moveDownBtn, swapBtn, deleteBtn]) {
      item.addEventListener('click', () => actionsMenu.hidePopover())
    }

    moveUpBtn.addEventListener('click', async () => {
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'up'))
    })

    moveDownBtn.addEventListener('click', async () => {
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'down'))
    })

    deleteBtn.addEventListener('click', async () => {
      const session = openSession.current
      const hasSets = session !== undefined && (this.progressIn(session)?.logged ?? 0) > 0
      const question = hasSets
        ? 'This exercise already has completed sets. Deleting it will result in lost progress. Are you sure?'
        : 'Are you sure you want to delete this exercise from the workout session?'
      if (!confirm(question)) return

      await openSession.apply((session) => workoutSessionsStore.removeExercise(session, this.exerciseId))
    })

    swapBtn.addEventListener('click', () => {
      const session = openSession.current
      if (
        session &&
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
    const addSetBtn = this.element.querySelector('.add-set-btn') as HTMLButtonElement

    nextSetForm.addEventListener('input', () => {
      this.typedIn = true
    })

    // The session stores the extra set, so the workout is not done until it is logged.
    addSetBtn.addEventListener('click', async () => {
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

      this.closeWhenDone = true
      try {
        await openSession.apply((session) => workoutSessionsStore.addSet(session, this.exerciseId, completedSet), {
          loggedFor: this.exerciseId
        })
      } finally {
        this.closeWhenDone = false
      }

      // The form keeps the set just logged as the next one's values, which are no longer last time's max, and which
      // the next session shown may fill in again.
      clearSetBadges(this.nextSetFields)
      this.typedIn = false
    })
  }
}

export default ExerciseCard
