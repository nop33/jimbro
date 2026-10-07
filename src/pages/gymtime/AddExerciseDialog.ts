import type { Exercise } from '../../db/stores/exercisesStore'

class AddExerciseDialog {
  private static dialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private static dialogCancel = this.dialog.querySelector('.dialog-cancel') as HTMLButtonElement
  private static addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  private static dialogTitle = this.dialog.querySelector('h2') as HTMLHeadingElement
  private static defaultCallback: ((exercise: Exercise) => void) | null = null
  private static currentCallback: ((exercise: Exercise) => void) | null = null

  static init(defaultOnExerciseClicked: (exercise: Exercise) => void) {
    this.defaultCallback = defaultOnExerciseClicked
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.closeDialog())
    this.addExerciseCard.addEventListener('click', () =>
      this.openDialog({ title: 'Add exercise', onExerciseClicked: defaultOnExerciseClicked })
    )
  }

  // The dialog's exercise list calls this with the exercise tapped.
  static pick(exercise: Exercise) {
    const onExerciseClicked = this.currentCallback ?? this.defaultCallback
    if (!onExerciseClicked) return

    onExerciseClicked(exercise)
    this.closeDialog()
  }

  static openDialog({
    title = 'Add exercise',
    onExerciseClicked
  }: { title?: string; onExerciseClicked?: (exercise: Exercise) => void } = {}) {
    if (this.dialogTitle) {
      this.dialogTitle.textContent = title
    }
    this.currentCallback = onExerciseClicked || null
    this.dialog.showModal()
  }

  static closeDialog() {
    this.dialog.close()
    this.currentCallback = null
  }
}

export default AddExerciseDialog
