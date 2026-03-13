import type { Exercise } from '../../db/stores/exercisesStore'
import type { ExerciseSetExecution } from '../../db/stores/workoutSessionsStore'
import Toasts from '../../features/toasts'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import { setTextContent } from '../../utils'

interface EditSetData {
  set: ExerciseSetExecution
  exerciseId: Exercise['id']
  index: number
}

class EditSetDialog {
  private editSetDialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private editSetForm = document.querySelector('#edit-set-form') as HTMLFormElement
  private setRepsInput = document.querySelector('#set-reps') as HTMLInputElement
  private setWeightInput = document.querySelector('#set-weight') as HTMLInputElement
  private editedSetData: EditSetData | null = null

  constructor() {
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.editSetForm.addEventListener('submit', (event) => this.onSubmit(event))
  }

  openDialog(editedSetData: EditSetData) {
    this.editedSetData = editedSetData
    this.editSetDialog.showModal()
    this.setRepsInput.value = editedSetData.set.reps.toString()
    this.setWeightInput.value = editedSetData.set.weight.toString()
  }

  closeDialog() {
    this.editSetDialog.close()
  }

  private async onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.editedSetData) throw new Error('No edited set data found')

    const formData = new FormData(this.editSetForm)
    const reps = formData.get('set-reps') as string
    const weight = formData.get('set-weight') as string

    if (weight === '0' || reps === '0') {
      if (!confirm(`Are you sure you want to submit a set with 0 ${weight === '0' ? 'weight' : 'reps'}?`)) return
    }

    const updatedSet = { reps: parseFloat(reps), weight: parseFloat(weight) }

    await GymtimeSessionState.updateSet(this.editedSetData.exerciseId, this.editedSetData.index, updatedSet)

    updateSetItem({
      set: updatedSet,
      exerciseId: this.editedSetData.exerciseId,
      index: this.editedSetData.index
    })

    this.closeDialog()
    Toasts.show({ message: 'Set updated.' })
  }
}

export default EditSetDialog

const updateSetItem = ({ set, exerciseId, index }: EditSetData) => {
  const setItem = document.querySelector(
    `[data-exercise-id="${exerciseId}"] [data-set-number="${index + 1}"]`
  ) as HTMLDivElement
  setTextContent('.set-reps', (set.reps || '-').toString(), setItem)
  setTextContent('.set-weight', (set.weight || '-').toString(), setItem)
  setItem.setAttribute('data-reps', set.reps.toString())
  setItem.setAttribute('data-weight', set.weight.toString())
}
