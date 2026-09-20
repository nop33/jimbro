import { setValues, type ExerciseSetExecution } from '../../db/exerciseLogging'
import type { Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import GymtimeSessionState from '../../state/GymtimeSessionState'
import { readSetFromForm, renderSetFields, renderSetInputs } from './setSlots'

interface EditSetData {
  set: ExerciseSetExecution
  exerciseId: Exercise['id']
  index: number
}

class EditSetDialog {
  private static dialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private static form = document.querySelector('#edit-set-form') as HTMLFormElement
  private static fields = document.querySelector('#edit-set-fields') as HTMLDivElement
  private static editedSetData: EditSetData | null = null

  static init() {
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.form.addEventListener('submit', (event) => this.onSubmit(event))
  }

  static openDialog(data: EditSetData) {
    this.editedSetData = data
    renderSetInputs(this.fields, data.set.preset, setValues(data.set))
    this.dialog.showModal()
  }

  static closeDialog() {
    this.dialog.close()
  }

  private static async onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.editedSetData) throw new Error('No edited set data found')

    const updatedSet = readSetFromForm(this.form, this.editedSetData.set.preset)
    const values = setValues(updatedSet)

    if (values.reps === 0 || (updatedSet.preset === 'lifting' && updatedSet.weight === 0)) {
      if (!confirm(`Are you sure you want to submit a set with 0 ${values.reps === 0 ? 'reps' : 'weight'}?`)) return
    }

    await GymtimeSessionState.updateSet(this.editedSetData.exerciseId, this.editedSetData.index, updatedSet)

    updateSetItem({ ...this.editedSetData, set: updatedSet })

    this.closeDialog()
    Toasts.show({ message: 'Set updated.' })
  }
}

export default EditSetDialog

const updateSetItem = ({ set, exerciseId, index }: EditSetData) => {
  const setItem = document.querySelector(
    `[data-exercise-id="${exerciseId}"] [data-set-number="${index + 1}"]`
  ) as HTMLDivElement
  renderSetFields(setItem.querySelector('.set-fields') as HTMLDivElement, set)
  setItem.dataset.set = JSON.stringify(set)
}
