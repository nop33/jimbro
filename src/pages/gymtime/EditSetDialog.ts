import EventEmitter from '../../db/eventEmitter'
import type { Exercise } from '../../db/stores/exercisesStore'
import {
  workoutSessionsStore,
  type ExerciseSetExecution,
  type WorkoutSession
} from '../../db/stores/workoutSessionsStore'
import Toasts from '../../features/toasts'
import { setTextContent } from '../../utils'

type EditedSetData = {
  set: ExerciseSetExecution
  workoutSession: WorkoutSession
  exerciseId: Exercise['id']
  index: number
}

type EditSetDialogEventMap = {
  'set-edited': { set: ExerciseSetExecution; workoutSession: WorkoutSession; exerciseId: Exercise['id']; index: number }
}

class EditSetDialog extends EventEmitter<EditSetDialogEventMap> {
  private editSetDialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private editSetForm = document.querySelector('#edit-set-form') as HTMLFormElement
  private setRepsInput = document.querySelector('#set-reps') as HTMLInputElement
  private setWeightInput = document.querySelector('#set-weight') as HTMLInputElement
  private editedSetData: EditedSetData | null = null

  constructor() {
    super()
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.editSetForm.addEventListener('submit', (event) => this.onSubmit(event))
  }

  openDialog(editedSetData: EditedSetData) {
    this.editedSetData = editedSetData
    this.editSetDialog.showModal()
    this.render(editedSetData.set)
  }

  closeDialog() {
    this.editSetDialog.close()
  }

  render(set: ExerciseSetExecution) {
    this.setRepsInput.value = set.reps.toString()
    this.setWeightInput.value = set.weight.toString()
  }

  async onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.editedSetData) throw new Error('No edited set data found')
    const formData = new FormData(this.editSetForm)
    const reps = formData.get('set-reps') as string
    const weight = formData.get('set-weight') as string

    if (weight === '0' || reps === '0') {
      const confirmed = confirm(`Are you sure you want to submit a set with 0 ${weight === '0' ? 'weight' : 'reps'}?`)
      if (!confirmed) return
    }

    if (!this.editedSetData.workoutSession) {
      throw new Error('No existing workout session found')
    }

    const updatedWorkoutSession = await workoutSessionsStore.updateExerciseExecutionSetInWorkoutSession({
      workoutSession: this.editedSetData.workoutSession,
      exerciseId: this.editedSetData.exerciseId,
      exerciseExecutionSetIndex: this.editedSetData.index,
      exerciseExecutionSet: { reps: parseFloat(reps), weight: parseFloat(weight) }
    })

    this.emit('set-edited', {
      set: { reps: parseFloat(reps), weight: parseFloat(weight) },
      workoutSession: updatedWorkoutSession,
      exerciseId: this.editedSetData.exerciseId,
      index: this.editedSetData.index
    })

    this.closeDialog()
    Toasts.show({ message: 'Set updated.' })
  }
}

export default EditSetDialog

export const updateSetItem = (editedSetData: EditedSetData) => {
  const oldSetItem = document.querySelector(
    `[data-exercise-id="${editedSetData.exerciseId}"] [data-set-number="${editedSetData.index + 1}"]`
  ) as HTMLDivElement
  setTextContent('.set-reps', (editedSetData.set.reps || '-').toString(), oldSetItem)
  setTextContent('.set-weight', (editedSetData.set.weight || '-').toString(), oldSetItem)
}
