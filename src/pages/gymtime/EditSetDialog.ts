import { setValues, type ExerciseSetExecution } from '../../db/exerciseLogging'
import type { Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { openSession } from './openSession'
import { readSetFromForm, renderSetInputs } from './setSlots'

interface EditSetData {
  set: ExerciseSetExecution
  exerciseId: Exercise['id']
  index: number
}

class EditSetDialog {
  private static dialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private static deleteBtn = this.dialog.querySelector('.delete-btn') as HTMLButtonElement
  private static form = document.querySelector('#edit-set-form') as HTMLFormElement
  private static fields = document.querySelector('#edit-set-fields') as HTMLDivElement
  private static editedSetData: EditSetData | null = null

  static init() {
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.form.addEventListener('submit', (event) => this.onSubmit(event))
    this.deleteBtn.addEventListener('click', () => this.onDelete())
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

    const { exerciseId, index } = this.editedSetData
    await openSession.apply((session) => workoutSessionsStore.updateSet(session, exerciseId, index, updatedSet))

    this.closeDialog()
    Toasts.show({ message: 'Set updated.' })
  }

  // The set's slot stays, to do again, and can be removed from its own menu.
  private static async onDelete() {
    if (!this.editedSetData) throw new Error('No edited set data found')
    const { exerciseId, index } = this.editedSetData
    if (!confirm(`Delete set ${index + 1}?`)) return

    await openSession.apply((session) => workoutSessionsStore.removeSet(session, exerciseId, index))
    this.closeDialog()
    Toasts.show({ message: 'Set deleted.' })
  }
}

export default EditSetDialog
