import EventEmitter from '../../db/eventEmitter'
import type { Exercise } from '../../db/stores/exercisesStore'

type AddExerciseDialogEventMap = {
  'exercise-selected': { exercise: Exercise }
}

class AddExerciseDialog extends EventEmitter<AddExerciseDialogEventMap> {
  private addExerciseDialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private dialogCancel = this.addExerciseDialog.querySelector('.dialog-cancel') as HTMLButtonElement

  constructor() {
    super()
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
  }

  openDialog() {
    this.addExerciseDialog.showModal()
  }

  closeDialog() {
    this.addExerciseDialog.close()
  }
}

export default AddExerciseDialog
