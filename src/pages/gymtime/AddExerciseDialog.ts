import type { Exercise } from '../../db/stores/exercisesStore'

class AddExerciseDialog {
  private dialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private dialogCancel = this.dialog.querySelector('.dialog-cancel') as HTMLButtonElement
  private addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  private dialogTitle = this.dialog.querySelector('h2') as HTMLHeadingElement
  private defaultCallback: (exercise: Exercise) => void
  private currentCallback: ((exercise: Exercise) => void) | null = null

  // defaultOnExerciseClicked adds the exercise tapped, unless an opening asks for something else, as a swap does.
  constructor(defaultOnExerciseClicked: (exercise: Exercise) => void) {
    this.defaultCallback = defaultOnExerciseClicked
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.addExerciseCard.addEventListener('click', () =>
      this.openDialog({ title: 'Add exercise', onExerciseClicked: defaultOnExerciseClicked })
    )
  }

  // The dialog's exercise list calls this with the exercise tapped.
  pick(exercise: Exercise) {
    const onExerciseClicked = this.currentCallback ?? this.defaultCallback
    onExerciseClicked(exercise)
    this.closeDialog()
  }

  openDialog({
    title = 'Add exercise',
    onExerciseClicked
  }: { title?: string; onExerciseClicked?: (exercise: Exercise) => void } = {}) {
    this.dialogTitle.textContent = title
    this.currentCallback = onExerciseClicked || null
    this.dialog.showModal()
  }

  closeDialog() {
    this.dialog.close()
    this.currentCallback = null
  }
}

export default AddExerciseDialog
