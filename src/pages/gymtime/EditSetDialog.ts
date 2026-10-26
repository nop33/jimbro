import { setValues, type ExerciseSetExecution } from '../../db/exerciseLogging'
import type { Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import type { OpenSession } from './openSession'
import { confirmZeroSet, readSetFromForm, renderSetInputs } from './setSlots'

interface EditSetData {
  set: ExerciseSetExecution
  exerciseId: Exercise['id']
  index: number
}

class EditSetDialog {
  private dialog = document.querySelector('#edit-set-dialog') as HTMLDialogElement
  private deleteBtn = this.dialog.querySelector('.delete-btn') as HTMLButtonElement
  private form = document.querySelector('#edit-set-form') as HTMLFormElement
  private fields = document.querySelector('#edit-set-fields') as HTMLDivElement
  private editedSetData: EditSetData | null = null
  private session: OpenSession

  constructor(session: OpenSession) {
    this.session = session
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.form.addEventListener('submit', (event) => this.onSubmit(event))
    this.deleteBtn.addEventListener('click', () => this.onDelete())
  }

  openDialog(data: EditSetData) {
    this.editedSetData = data
    renderSetInputs(this.fields, data.set.preset, setValues(data.set))
    this.dialog.showModal()
  }

  closeDialog() {
    this.dialog.close()
  }

  private async onSubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!this.editedSetData) throw new Error('No edited set data found')

    const updatedSet = readSetFromForm(this.form, this.editedSetData.set.preset)
    if (!confirmZeroSet(updatedSet)) return

    const { exerciseId, index } = this.editedSetData
    await this.session.apply((session) => workoutSessionsStore.updateSet(session, exerciseId, index, updatedSet))

    this.closeDialog()
    Toasts.show({ message: 'Set updated.' })
  }

  // The set's slot stays, to do again, and can be removed from its own menu.
  private async onDelete() {
    if (!this.editedSetData) throw new Error('No edited set data found')
    const { exerciseId, index } = this.editedSetData
    if (!confirm(`Delete set ${index + 1}?`)) return

    await this.session.apply((session) => workoutSessionsStore.removeSet(session, exerciseId, index))
    this.closeDialog()
    Toasts.show({ message: 'Set deleted.' })
  }
}

export default EditSetDialog
