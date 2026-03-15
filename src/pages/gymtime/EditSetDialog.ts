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
  private static dialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private static form = document.querySelector('#edit-set-form') as HTMLFormElement
  private static repsInput = document.querySelector('#set-reps') as HTMLInputElement
  private static weightInput = document.querySelector('#set-weight') as HTMLInputElement
  private static editedSetData: EditSetData | null = null

  static init() {
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.form.addEventListener('submit', (event) => this.onSubmit(event))
  }

  static openDialog(data: EditSetData) {
    this.editedSetData = data
    this.repsInput.value = data.set.reps.toString()
    this.weightInput.value = data.set.weight.toString()
    this.dialog.showModal()
  }

  static closeDialog() {
    this.dialog.close()
  }

  private static async onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.editedSetData) throw new Error('No edited set data found')

    const formData = new FormData(this.form)
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
