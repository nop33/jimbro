import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseDialog {
  private static newExerciseButton = document.querySelector('#new-exercise-btn') as HTMLButtonElement
  private static exerciseDialog = document.querySelector('#exercise-dialog') as HTMLDialogElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private static exerciseForm = document.querySelector('#exercise-form') as HTMLFormElement
  private static exerciseIdInput = document.querySelector('#exercise-id') as HTMLInputElement
  private static dialogTitle = document.querySelector('#dialog-title') as HTMLHeadingElement
  private static deleteExerciseBtn = document.querySelector('#delete-exercise-btn') as HTMLButtonElement

  static openDialog() {
    this.exerciseDialog.showModal()
  }

  static closeDialog() {
    this.exerciseDialog.close()
  }

  static init() {
    this.renderMusclePicker()
    this.render()

    this.newExerciseButton.addEventListener('click', () => {
      this.render()
      this.openDialog()
    })

    this.dialogCancel.addEventListener('click', () => {
      this.closeDialog()
    })

    this.deleteExerciseBtn.addEventListener('click', () => {
      this.deleteExercise()
    })

    this.exerciseForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const formData = new FormData(this.exerciseForm)
      const id = this.exerciseIdInput.value
      const name = formData.get('name') as string
      const muscle = formData.get('muscle') as Exercise['muscle']
      const sets = parseInt(formData.get('sets') as string)
      const reps = parseInt(formData.get('reps') as string)

      try {
        if (id) {
          await exercisesStore.updateExercise({ id, name, muscle, sets, reps })
        } else {
          await exercisesStore.createExercise({ name, muscle, sets, reps })
        }

        this.closeDialog()
        Toasts.show({ message: 'Exercise saved!' })
      } catch (error) {
        console.error('Error saving exercise:', error)
        Toasts.show({ message: `Could not save exercise: ${error}`, type: 'error' })
      }
    })
  }

  static render(exercise?: Exercise) {
    if (exercise) {
      this.dialogTitle.textContent = 'Edit Exercise'
      this.exerciseIdInput.value = exercise.id
      this.deleteExerciseBtn.classList.remove('hidden')
      ;(document.querySelector('#exercise-name') as HTMLInputElement).value = exercise.name
      ;(document.querySelector('#exercise-muscle') as HTMLSelectElement).value = exercise.muscle
      ;(document.querySelector('#exercise-sets') as HTMLInputElement).value = exercise.sets.toString()
      ;(document.querySelector('#exercise-reps') as HTMLInputElement).value = exercise.reps.toString()
    } else {
      this.dialogTitle.textContent = 'New Exercise'
      this.exerciseForm.reset()
      this.exerciseIdInput.value = ''
      this.deleteExerciseBtn.classList.add('hidden')
    }
  }

  static renderMusclePicker() {
    const musclePicker = new MuscleGroupSelect({ selector: '#exercise-muscle' })
    musclePicker.render({ includeOptionAll: false })
  }

  static deleteExercise() {
    if (confirm('Are you sure you want to delete this exercise?')) {
      exercisesStore.softDeleteExercise(this.exerciseIdInput.value)
      this.closeDialog()
      Toasts.show({ message: 'Exercise deleted.' })
    }
  }
}

export default ExerciseDialog
