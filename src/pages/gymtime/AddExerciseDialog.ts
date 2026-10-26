import type { Exercise } from '../../db/stores/exercisesStore'

class AddExerciseDialog {
  private dialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private dialogCancel = this.dialog.querySelector('.dialog-cancel') as HTMLButtonElement
  private addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  private dialogTitle = this.dialog.querySelector('h2') as HTMLHeadingElement
  private addExercise: (exercise: Exercise) => void
  private onPick: (exercise: Exercise) => void

  // addExercise adds the exercise tapped, unless an opening asks for something else, as a swap does.
  constructor(addExercise: (exercise: Exercise) => void) {
    this.addExercise = addExercise
    this.onPick = addExercise
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.addExerciseCard.addEventListener('click', () => this.openDialog())
  }

  // The dialog's exercise list calls this with the exercise tapped.
  pick(exercise: Exercise) {
    this.onPick(exercise)
    this.closeDialog()
  }

  openDialog({
    title = 'Add exercise',
    onExerciseClicked = this.addExercise
  }: { title?: string; onExerciseClicked?: (exercise: Exercise) => void } = {}) {
    this.dialogTitle.textContent = title
    this.onPick = onExerciseClicked
    this.dialog.showModal()
  }

  closeDialog() {
    this.dialog.close()
  }
}

export default AddExerciseDialog
