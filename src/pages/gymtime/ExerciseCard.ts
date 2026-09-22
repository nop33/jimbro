import { db } from '../../db'
import {
  breakTimerEnabled,
  emptySet,
  historyChartEnabled,
  EXERCISE_KIND_LABELS,
  setValues,
  type ExerciseDefaults,
  type ExerciseSetExecution
} from '../../db/exerciseLogging'
import { exportIndexedDbToJson } from '../../db/export'
import { muscleGroupLabel } from '../../db/stores/exercisesStore'
import { snapshotFromExercise, workoutSessionsStore, type ExerciseSnapshot } from '../../db/stores/workoutSessionsStore'
import { throwConfetti } from '../../features/confetti'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import { getBreakTimeSeconds } from '../../settings'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { animateDetails, type AnimateDetailsHandle } from './animateDetails'
import BreakTimerDialog from './BreakTimerDialog'
import EditSetDialog from './EditSetDialog'
import AddExerciseDialog from './AddExerciseDialog'
import ExerciseHistoryChart from './ExerciseHistoryChart'
import LastSetDialog from './LastSetDialog'
import { configureSetRowGrid, readSetFromForm, renderSetFields, renderSetInputs } from './setSlots'
import { getCloudBackupConfig, uploadToCloud } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'

export interface ExerciseCardConfig {
  snapshot: ExerciseSnapshot
  programId: string
  programExerciseIds: string[]
  onExerciseDeleted: () => void
}

class ExerciseCard {
  private snapshot: ExerciseSnapshot
  private programExerciseIds: string[]
  private onExerciseDeleted: () => void
  private targetSets: number

  constructor(config: ExerciseCardConfig) {
    this.snapshot = config.snapshot
    this.programExerciseIds = config.programExerciseIds
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
    const viewHistoryBtn = template.querySelector('.view-history-btn') as HTMLButtonElement
    const viewLastSetBtn = template.querySelector('.view-last-set-btn') as HTMLButtonElement

    cardDiv.setAttribute('data-exercise-id', this.exerciseId)

    const detailsAnimation = animateDetails(exerciseDetails, detailsContent, {
      accordionSelector: '.exercise-details'
    })

    const session = GymtimeSessionState.session
    const existingExercise = session?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)

    // Determine the dynamic targetSets (if there is a last session that had more sets, use that instead of the default, unless we've already done more)
    let lastSessionSetsCount = this.snapshot.targetSets
    if (session) {
      const lastSession = await workoutSessionsStore.getLatestWorkoutSessionWithCompletedExercise(
        this.exerciseId,
        1,
        session.location
      )
      if (lastSession) {
        const lastSessionExercise = lastSession.exercises.find((e) => e.exerciseId === this.exerciseId)
        if (lastSessionExercise) {
          lastSessionSetsCount = lastSessionExercise.sets.length
        }
      }
    }

    this.targetSets = Math.max(
      this.snapshot.targetSets,
      lastSessionSetsCount,
      existingExercise ? existingExercise.sets.length : 0
    )

    const isExerciseCompleted = () => {
      const session = GymtimeSessionState.session
      if (!session) return false
      const existingExercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)
      return existingExercise && existingExercise.sets.length >= this.targetSets
    }

    exerciseDetails.addEventListener('toggle', () => {
      if (isExerciseCompleted()) {
        deleteBtn.classList.add('hidden')
        swapBtn.classList.add('hidden')
        moveUpBtn.classList.add('hidden')
        moveDownBtn.classList.add('hidden')
      } else {
        deleteBtn.classList.toggle('hidden', !exerciseDetails.open)
        swapBtn.classList.toggle('hidden', !exerciseDetails.open)
        moveUpBtn.classList.toggle('hidden', !exerciseDetails.open)
        moveDownBtn.classList.toggle('hidden', !exerciseDetails.open)

        if (exerciseDetails.open) {
          const session = GymtimeSessionState.session
          if (session) {
            const exerciseIndex = session.exercises.findIndex(({ exerciseId }) => exerciseId === this.exerciseId)
            if (exerciseIndex === 0) moveUpBtn.classList.add('hidden')
            if (exerciseIndex === session.exercises.length - 1) moveDownBtn.classList.add('hidden')
          }
        }
      }
    })

    moveUpBtn.addEventListener('click', async () => {
      if (!GymtimeSessionState.session) return
      await GymtimeSessionState.moveExercise(this.exerciseId, 'up')
      this.onExerciseDeleted()
    })

    moveDownBtn.addEventListener('click', async () => {
      if (!GymtimeSessionState.session) return
      await GymtimeSessionState.moveExercise(this.exerciseId, 'down')
      this.onExerciseDeleted()
    })

    deleteBtn.addEventListener('click', async () => {
      if (!GymtimeSessionState.session) {
        alert('Start a workout session first')
        return
      }

      const session = GymtimeSessionState.session
      const existingExercise = session.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)

      if (existingExercise && existingExercise.sets.length > 0) {
        if (
          !confirm('This exercise already has completed sets. Deleting it will result in lost progress. Are you sure?')
        )
          return
      } else {
        if (!confirm('Are you sure you want to delete this exercise from the workout session?')) return
      }

      await GymtimeSessionState.deleteExercise(this.exerciseId)
      this.onExerciseDeleted()
    })

    swapBtn.addEventListener('click', () => {
      if (!GymtimeSessionState.session) {
        alert('Start a workout session first')
        return
      }

      const session = GymtimeSessionState.session
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
          if (newExercise.id === this.exerciseId) return

          if (GymtimeSessionState.hasExercise(newExercise.id, { showAlert: true })) {
            return
          }

          await GymtimeSessionState.swapExercise(this.exerciseId, newExercise.id)
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

    await this.setupNextSetForm(template, completedSets, detailsAnimation, cardDiv, nextSetDiv)

    if (existingExercise && existingExercise.sets.length >= this.targetSets) {
      nextSetDiv.classList.add('hidden')
    }

    if (historyChartEnabled(this.snapshot.kind)) {
      viewHistoryBtn.addEventListener('click', () => {
        ExerciseHistoryChart.openDialog({
          id: this.exerciseId,
          name: this.snapshot.name,
          kind: this.snapshot.kind
        })
      })
    } else {
      viewHistoryBtn.classList.add('hidden')
    }

    const lastSession = await workoutSessionsStore.getLatestWorkoutSessionWithCompletedExercise(
      this.exerciseId,
      1,
      session?.location
    )

    if (lastSession) {
      viewLastSetBtn.addEventListener('click', () => {
        const lastExercise = lastSession.exercises.find((e) => e.exerciseId === this.exerciseId)
        if (lastExercise) {
          LastSetDialog.openDialog(lastExercise.sets, lastSession.date, lastSession.location)
        }
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
      if (!GymtimeSessionState.session) throw new Error('No existing workout session found')

      EditSetDialog.openDialog({
        set: JSON.parse(div.dataset.set as string) as ExerciseSetExecution,
        exerciseId: this.exerciseId,
        index
      })
    })

    return template
  }

  private async prefillValues(): Promise<ExerciseDefaults> {
    const { preset, defaults } = this.snapshot
    const session = GymtimeSessionState.session
    const currentSet = session?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)?.sets.at(-1)

    if (currentSet) return { ...defaults, ...setValues(currentSet) }

    const latestSession = await workoutSessionsStore.getLatestWorkoutSessionWithCompletedExercise(
      this.exerciseId,
      this.snapshot.targetSets
    )
    const previousSets = (
      latestSession?.exercises.find(({ exerciseId }) => exerciseId === this.exerciseId)?.sets ?? []
    ).filter((set) => set.preset === preset)

    const previousSet = previousSets.at(-1)
    const prefill = previousSet ? { ...defaults, ...setValues(previousSet) } : { ...defaults }

    if (preset === 'lifting' && previousSets.length > 0) {
      const maxWeight = Math.max(...previousSets.map((set) => setValues(set).weight ?? 0))
      if (maxWeight > 0) prefill.weight = maxWeight
    }

    if (preset === 'cardioTreadmill' && prefill.incline === undefined) prefill.incline = 0

    return prefill
  }

  private async setupNextSetForm(
    template: DocumentFragment,
    completedSets: HTMLDivElement,
    detailsAnimation: AnimateDetailsHandle,
    cardDiv: HTMLDivElement,
    nextSetDiv: HTMLDivElement
  ) {
    const { preset } = this.snapshot
    const nextSetForm = template.querySelector('.next-set-form') as HTMLFormElement
    const nextSetFields = nextSetForm.querySelector('.next-set-fields') as HTMLDivElement
    const addExtraSetBtn = template.querySelector('.add-extra-set-btn') as HTMLButtonElement

    renderSetInputs(nextSetFields, preset, await this.prefillValues())

    const currentIndex = this.programExerciseIds.findIndex((id) => id === this.exerciseId)

    if (addExtraSetBtn) {
      addExtraSetBtn.addEventListener('click', () => {
        this.targetSets += 1
        cardDiv.classList.remove('card-success')
        nextSetDiv.classList.remove('hidden')
        completedSets.appendChild(
          this.renderSetItem({ set: emptySet(preset), index: this.targetSets - 1, isCompleted: false })
        )
      })
    }

    nextSetForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const completedSet = readSetFromForm(nextSetForm, preset)
      const values = setValues(completedSet)

      if (values.reps === 0 || (completedSet.preset === 'lifting' && completedSet.weight === 0)) {
        if (!confirm(`Are you sure you want to submit a set with 0 ${values.reps === 0 ? 'reps' : 'weight'}?`)) return
      }

      if (!GymtimeSessionState.session) throw new Error('No existing workout session found')

      await GymtimeSessionState.addSet(this.exerciseId, completedSet)

      const updated = GymtimeSessionState.session!
      const setIndex = (updated.exercises.find(({ exerciseId: id }) => id === this.exerciseId)?.sets.length ?? 1) - 1

      // If user adds an extra set after finishing, the DOM might not have a pending slot for it if they didn't use the Add Set button
      // But if they clicked "Add set", the pending slot is there. Let's make sure it exists.
      let pendingSetItem = completedSets.querySelector(`[data-set-number="${setIndex + 1}"]`) as HTMLDivElement
      if (!pendingSetItem) {
        this.targetSets = Math.max(this.targetSets, setIndex + 1)
        completedSets.appendChild(this.renderSetItem({ set: emptySet(preset), index: setIndex, isCompleted: false }))
        pendingSetItem = completedSets.querySelector(`[data-set-number="${setIndex + 1}"]`) as HTMLDivElement
      }

      pendingSetItem.classList.remove('isPending')
      pendingSetItem.classList.add('isCompleted')
      renderSetFields(pendingSetItem.querySelector('.set-fields') as HTMLDivElement, completedSet)
      pendingSetItem.dataset.set = JSON.stringify(completedSet)

      if (setIndex + 1 >= this.targetSets) {
        detailsAnimation.close()
        cardDiv.classList.add('card-success')
        nextSetDiv.classList.add('hidden')
      }

      if (updated.status === 'completed') {
        throwConfetti('Workout done!')

        if (getCloudBackupConfig()) {
          uploadToCloud()
            .then(() => Toasts.show({ message: 'Backup saved ☁️', type: 'success' }))
            .catch((error) => Toasts.show({ message: `Backup failed: ${error.message}`, type: 'error' }))
        } else {
          exportIndexedDbToJson()
        }
      } else {
        const isExerciseCompleted = this.targetSets === setIndex + 1

        if (isExerciseCompleted) {
          navigator.vibrate?.([50, 30, 50, 30, 70])
          BreakTimerDialog.closeDialog()
          throwConfetti('Exercise done!')
        } else {
          let nextExercise
          if (updated && currentIndex >= 0) {
            for (let i = 1; i < this.programExerciseIds.length; i++) {
              const checkIndex = (currentIndex + i) % this.programExerciseIds.length
              const checkId = this.programExerciseIds[checkIndex]

              if (checkId === this.exerciseId) continue

              const sessionExercise = updated.exercises.find(({ exerciseId }) => exerciseId === checkId)
              const catalogEx = sessionExercise ? undefined : await db.exercises.getById(checkId)
              const target = sessionExercise ?? (catalogEx && snapshotFromExercise(catalogEx))
              if (!target) continue

              if ((sessionExercise?.sets.length ?? 0) < target.targetSets) {
                nextExercise = target
                break
              }
            }
          }

          const breakTimeSeconds = getBreakTimeSeconds()

          if (breakTimerEnabled(preset)) {
            BreakTimerDialog.startTimer({
              minutes: Math.floor(breakTimeSeconds / 60),
              seconds: breakTimeSeconds % 60,
              setsDone: setIndex + 1,
              setsTotal: this.targetSets,
              nextExercise: nextExercise?.name,
              currentExercise: { id: this.exerciseId, name: this.snapshot.name, kind: this.snapshot.kind }
            })
          }
        }
      }
    })
  }
}

export default ExerciseCard
