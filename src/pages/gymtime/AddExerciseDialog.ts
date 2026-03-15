import type { Exercise } from '../../db/stores/exercisesStore'

class AddExerciseDialog {
  private static dialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private static dialogCancel = this.dialog.querySelector('.dialog-cancel') as HTMLButtonElement
  private static addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement
  private static dialogTitle = this.dialog.querySelector('h2') as HTMLHeadingElement
  private static currentCallback: ((exercise: Exercise) => void) | null = null

  static init(defaultOnExerciseClicked: (exercise: Exercise) => void) {
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.addExerciseCard.addEventListener('click', () => this.openDialog({ title: 'Add exercise', onExerciseClicked: defaultOnExerciseClicked }))

    window.addEventListener('exercise-clicked', (e) => {
      const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
      if (this.currentCallback) {
        this.currentCallback(exercise)
      } else {
        defaultOnExerciseClicked(exercise)
      }
      this.closeDialog()
    })
  }

  static openDialog({ title = 'Add exercise', onExerciseClicked }: { title?: string, onExerciseClicked?: (exercise: Exercise) => void } = {}) {
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
