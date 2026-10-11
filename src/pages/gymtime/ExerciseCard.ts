import {
  breakTimerEnabled,
  emptySet,
  historyChartEnabled,
  EXERCISE_KIND_LABELS,
  setValues,
  type ExerciseSetExecution
} from '../../db/exerciseLogging'
import { muscleGroupLabel } from '../../db/muscleGroups'
import { snapshotFromExercise, workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
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
import { planExercise, startingTargetSets, type ExercisePlan } from './exercisePlan'
import { clearSetNotes, configureSetRowGrid, readSetFromForm, renderSetFields, renderSetInputs } from './setSlots'

// Room the actions menu needs below its button: four 48px items and a margin.
const MENU_ROOM = 220

export interface ExerciseCardConfig {
  snapshot: ExerciseSnapshot
  onExerciseDeleted: () => void
}

class ExerciseCard {
  private snapshot: ExerciseSnapshot
  private onExerciseDeleted: () => void
  private targetSets: number

  constructor(config: ExerciseCardConfig) {
    this.snapshot = config.snapshot
    this.onExerciseDeleted = config.onExerciseDeleted
    this.targetSets = config.snapshot.targetSets
  }

  private get exerciseId(): string {
    return this.snapshot.exerciseId
  }

  async render(): Promise<DocumentFragment> {
    const template = nodeFromTemplate('#workout-exercise-item-template')
    const exerciseDetails = template.querySelector('.exercise-details') as HTMLDetailsElement
    const detailsContent = exerciseDetails.querySelector('.exercise-details-content') as HTMLDivElement
    const completedSets = exerciseDetails.querySelector('.completed-sets') as HTMLDivElement
    const cardDiv = template.querySelector('div') as HTMLDivElement
    const nextSetDiv = template.querySelector('.next-set') as HTMLDivElement
    const submitButton = nextSetDiv.querySelector('button[type="submit"]') as HTMLButtonElement
    const deleteBtn = template.querySelector('.delete-workout-session-exercise-btn') as HTMLButtonElement
    const swapBtn = template.querySelector('.swap-workout-session-exercise-btn') as HTMLButtonElement
    const moveUpBtn = template.querySelector('.move-up-workout-session-exercise-btn') as HTMLButtonElement
    const moveDownBtn = template.querySelector('.move-down-workout-session-exercise-btn') as HTMLButtonElement
    const actionsBtn = template.querySelector('.exercise-actions-btn') as HTMLButtonElement
    const viewHistoryBtn = template.querySelector('.view-history-btn') as HTMLButtonElement
    const viewLastSetBtn = template.querySelector('.view-last-set-btn') as HTMLButtonElement

    cardDiv.setAttribute('data-exercise-id', this.exerciseId)

    const detailsAnimation = animateDetails(exerciseDetails, detailsContent, {
      accordionSelector: '.exercise-details'
    })

    const session = openSession.current
    const existingExercise = session?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)

    const plan = await planExercise(this.snapshot, session)
    this.targetSets = plan.targetSets

    const isExerciseCompleted = () => {
      const session = openSession.current
      if (!session) return false
      const existingExercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)
      return existingExercise && existingExercise.sets.length >= this.targetSets
    }

    // A popover gives light dismiss (outside tap, Esc) and the button's aria-expanded for free.
    // Script places it, since CSS anchor positioning is missing from older iOS versions.
    const actionsMenu = template.querySelector('.exercise-actions-menu') as HTMLDivElement
    actionsBtn.popoverTargetElement = actionsMenu
    actionsBtn.setAttribute('aria-label', `Actions for ${this.snapshot.name}`)

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
      const completed = isExerciseCompleted()
      swapBtn.classList.toggle('hidden', completed)
      deleteBtn.classList.toggle('hidden', completed)

      const exercises = openSession.current?.exercises ?? []
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
      // A card rebuild removes the menu without a toggle event, so the listener drops itself then.
      const follow = () => (actionsMenu.isConnected ? placeMenu() : followScroll?.abort())
      document.addEventListener('scroll', follow, { capture: true, passive: true, signal })
    })

    for (const item of [moveUpBtn, moveDownBtn, swapBtn, deleteBtn]) {
      item.addEventListener('click', () => actionsMenu.hidePopover())
    }

    moveUpBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'up'))
      this.onExerciseDeleted()
    })

    moveDownBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      await openSession.apply((session) => workoutSessionsStore.moveExercise(session, this.exerciseId, 'down'))
      this.onExerciseDeleted()
    })

    deleteBtn.addEventListener('click', async () => {
      if (!openSession.current) {
        alert('Start a workout session first')
        return
      }

      const session = openSession.current
      const existingExercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)

      if (existingExercise && existingExercise.sets.length > 0) {
        if (
          !confirm('This exercise already has completed sets. Deleting it will result in lost progress. Are you sure?')
        )
          return
      } else {
        if (!confirm('Are you sure you want to delete this exercise from the workout session?')) return
      }

      await openSession.apply((session) => workoutSessionsStore.removeExercise(session, this.exerciseId))
      this.onExerciseDeleted()
    })

    swapBtn.addEventListener('click', () => {
      if (!openSession.current) {
        alert('Start a workout session first')
        return
      }

      const session = openSession.current
      const existingExercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)

      if (existingExercise && existingExercise.sets.length > 0) {
        if (
          !confirm(
            'This exercise already has completed sets. Swapping it will result in lost progress. Are you sure you want to proceed?'
          )
        )
          return
      }

      AddExerciseDialog.openDialog({
        title: 'Swap exercise',
        onExerciseClicked: async (newExercise) => {
          if (newExercise.id === this.exerciseId || alertIfInSession(newExercise.id)) return

          await openSession.apply(async (session) =>
            workoutSessionsStore.swapExercise(
              session,
              this.exerciseId,
              newExercise,
              await startingTargetSets(snapshotFromExercise(newExercise), session)
            )
          )
          this.onExerciseDeleted()
        }
      })
    })

    const { kind, muscle } = this.snapshot
    const kindLabel = EXERCISE_KIND_LABELS[kind]

    setTextContent('.exercise-name', this.snapshot.name, template)
    setTextContent('.exercise-muscle', muscle ? muscleGroupLabel(muscle) : kindLabel, template)

    const kindBadge = template.querySelector('.exercise-kind') as HTMLSpanElement | null
    if (kindBadge && muscle && kind !== 'lifting') {
      kindBadge.textContent = kindLabel
      kindBadge.classList.remove('hidden')
    }

    const placeholder = () => emptySet(this.snapshot.preset)

    configureSetRowGrid(completedSets, this.snapshot.preset)

    if (existingExercise) {
      if (existingExercise.sets.length >= this.targetSets) {
        cardDiv.classList.add('card-success')
      }

      for (const [index, set] of existingExercise.sets.entries()) {
        completedSets.appendChild(this.renderSetItem({ set, index }))
      }

      for (let i = existingExercise.sets.length; i < this.targetSets; i++) {
        completedSets.appendChild(this.renderSetItem({ set: placeholder(), index: i, isCompleted: false }))
      }
    } else {
      for (let i = 0; i < this.targetSets; i++) {
        completedSets.appendChild(this.renderSetItem({ set: placeholder(), index: i, isCompleted: false }))
      }
    }

    if (!session) {
      submitButton.classList.add('hidden')
    } else {
      submitButton.classList.remove('hidden')
    }

    this.setupNextSetForm(template, completedSets, detailsAnimation, cardDiv, nextSetDiv, plan)

    if (existingExercise && existingExercise.sets.length >= this.targetSets) {
      nextSetDiv.classList.add('hidden')
    }

    if (historyChartEnabled(this.snapshot.kind)) {
      viewHistoryBtn.addEventListener('click', () => {
        void ExerciseHistoryChart.openDialog({
          id: this.exerciseId,
          name: this.snapshot.name,
          kind: this.snapshot.kind
        })
      })
    } else {
      viewHistoryBtn.classList.add('hidden')
    }

    const { lastTime } = plan
    if (lastTime) {
      viewLastSetBtn.addEventListener('click', () => {
        void LastSetDialog.openDialog(lastTime.sets, lastTime.date, lastTime.location)
      })
    } else {
      viewLastSetBtn.classList.add('hidden')
    }

    return template
  }

  private renderSetItem({
    set,
    index,
    isCompleted = true
  }: {
    set: ExerciseSetExecution
    index: number
    isCompleted?: boolean
  }) {
    const template = nodeFromTemplate('#completed-set-item-template')
    const div = template.querySelector('div') as HTMLDivElement
    const setNumber = (index + 1).toString()

    setTextContent('.set-number', setNumber, template)
    renderSetFields(template.querySelector('.set-fields') as HTMLDivElement, set)

    div.classList.add(isCompleted ? 'isCompleted' : 'isPending')
    div.setAttribute('data-set-number', setNumber)
    div.dataset.set = JSON.stringify(set)

    div.addEventListener('click', () => {
      if (!div.classList.contains('isCompleted')) return
      if (!openSession.current) throw new Error('No existing workout session found')

      EditSetDialog.openDialog({
        set: JSON.parse(div.dataset.set as string) as ExerciseSetExecution,
        exerciseId: this.exerciseId,
        index
      })
    })

    return template
  }

  private setupNextSetForm(
    template: DocumentFragment,
    completedSets: HTMLDivElement,
    detailsAnimation: AnimateDetailsHandle,
    cardDiv: HTMLDivElement,
    nextSetDiv: HTMLDivElement,
    plan: ExercisePlan
  ) {
    const { preset } = this.snapshot
    const nextSetForm = template.querySelector('.next-set-form') as HTMLFormElement
    const nextSetFields = nextSetForm.querySelector('.next-set-fields') as HTMLDivElement
    const addExtraSetBtn = template.querySelector('.add-extra-set-btn') as HTMLButtonElement

    renderSetInputs(nextSetFields, preset, plan.prefill, plan.prefillIsMax ? { weight: 'Max last time' } : {})

    // The session stores the extra set, so the workout is not done until it is logged.
    addExtraSetBtn.addEventListener('click', async () => {
      if (!openSession.current) return
      const updated = await openSession.apply((session) => workoutSessionsStore.addSetSlot(session, this.exerciseId))
      const exercise = updated.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)
      if (!exercise) return
      this.targetSets = exercise.targetSets
      cardDiv.classList.remove('card-success')
      nextSetDiv.classList.remove('hidden')
      completedSets.appendChild(
        this.renderSetItem({ set: emptySet(preset), index: this.targetSets - 1, isCompleted: false })
      )
    })

    nextSetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const completedSet = readSetFromForm(nextSetForm, preset)
      const values = setValues(completedSet)

      if (values.reps === 0 || (completedSet.preset === 'lifting' && completedSet.weight === 0)) {
        if (!confirm(`Are you sure you want to submit a set with 0 ${values.reps === 0 ? 'reps' : 'weight'}?`)) return
      }

      const updated = await openSession.apply((session) =>
        workoutSessionsStore.addSet(session, this.exerciseId, completedSet)
      )
      const exercise = updated.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)
      if (!exercise) return
      const setIndex = exercise.sets.length - 1
      this.targetSets = Math.max(exercise.targetSets, exercise.sets.length)

      let pendingSetItem = completedSets.querySelector(`[data-set-number="${setIndex + 1}"]`) as HTMLDivElement
      if (!pendingSetItem) {
        completedSets.appendChild(this.renderSetItem({ set: emptySet(preset), index: setIndex, isCompleted: false }))
        pendingSetItem = completedSets.querySelector(`[data-set-number="${setIndex + 1}"]`) as HTMLDivElement
      }

      pendingSetItem.classList.remove('isPending')
      pendingSetItem.classList.add('isCompleted')
      renderSetFields(pendingSetItem.querySelector('.set-fields') as HTMLDivElement, completedSet)
      pendingSetItem.dataset.set = JSON.stringify(completedSet)

      // The form keeps the set just logged as the next one's values, which are no longer last time's max.
      clearSetNotes(nextSetFields)

      const isExerciseCompleted = exercise.sets.length >= this.targetSets
      if (isExerciseCompleted) {
        detailsAnimation.close()
        cardDiv.classList.add('card-success')
        nextSetDiv.classList.add('hidden')
      }

      // openSession celebrates the set that finishes the workout.
      if (updated.status === 'completed') return

      if (isExerciseCompleted) {
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
          setsDone: setIndex + 1,
          setsTotal: this.targetSets,
          nextExercise: nextUnfinished(updated, this.exerciseId)?.name,
          currentExercise: { id: this.exerciseId, name: this.snapshot.name, kind: this.snapshot.kind }
        })
      }
    })
  }
}

// The first exercise after this one, wrapping round, that still has sets to do.
const nextUnfinished = (session: WorkoutSession, exerciseId: string) => {
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId)
  const after = [...session.exercises.slice(index + 1), ...session.exercises.slice(0, index)]
  return after.find((exercise) => exercise.sets.length < exercise.targetSets)
}

export default ExerciseCard
