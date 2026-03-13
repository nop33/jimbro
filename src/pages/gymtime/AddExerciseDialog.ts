import type { Exercise } from '../../db/stores/exercisesStore'

class AddExerciseDialog {
  private static dialog = document.querySelector('#add-exercise-dialog') as HTMLDialogElement
  private static dialogCancel = this.dialog.querySelector('.dialog-cancel') as HTMLButtonElement
  private static addExerciseCard = document.querySelector('#add-exercise-card') as HTMLDivElement

  static init(onExerciseClicked: (exercise: Exercise) => void) {
    this.dialogCancel.addEventListener('click', () => this.closeDialog())
    this.addExerciseCard.addEventListener('click', () => this.openDialog())

    window.addEventListener('exercise-clicked', (e) => {
      const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
      onExerciseClicked(exercise)
      this.closeDialog()
    })
  }

  static openDialog() {
    this.dialog.showModal()
  }

  static closeDialog() {
    this.dialog.close()
  }
}

export default AddExerciseDialog
