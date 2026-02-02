import Dialog from '../../../components/Dialog'
import { exercisesStore, type Exercise } from '../../../db/stores/exercisesStore'
import Toasts, { showErrorToast } from '../../../features/toasts'
import { requireElement } from '../../../utils'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseDialog extends Dialog {
  private exerciseForm: HTMLFormElement
  private exerciseIdInput: HTMLInputElement
  private dialogTitle: HTMLHeadingElement
  private deleteExerciseBtn: HTMLButtonElement
  private exerciseNameInput: HTMLInputElement
  private exerciseMuscleInput: HTMLSelectElement
  private exerciseSetsInput: HTMLInputElement
  private exerciseRepsInput: HTMLInputElement
  private musclePicker?: MuscleGroupSelect

  constructor(dialogIdSelector: string) {
    super(dialogIdSelector)
    this.exerciseForm = requireElement('#exercise-form', this.dialog)
    this.exerciseIdInput = requireElement('#exercise-id', this.dialog)
    this.dialogTitle = requireElement('#dialog-title', this.dialog)
    this.deleteExerciseBtn = requireElement('#delete-exercise-btn', this.dialog)
    this.exerciseNameInput = requireElement('#exercise-name', this.dialog)
    this.exerciseMuscleInput = requireElement('#exercise-muscle', this.dialog)
    this.exerciseSetsInput = requireElement('#exercise-sets', this.dialog)
    this.exerciseRepsInput = requireElement('#exercise-reps', this.dialog)

    this.renderMusclePicker()
    this.wireEventHandlers()
  }

  render(exercise?: Exercise) {
    if (!exercise) {
      this.dialogTitle.textContent = 'New Exercise'
      this.deleteExerciseBtn.classList.add('hidden')
      this.exerciseForm.reset()
      return
    }

    this.dialogTitle.textContent = 'Edit Exercise'
    this.deleteExerciseBtn.classList.remove('hidden')

    this.exerciseIdInput.value = exercise.id
    this.exerciseNameInput.value = exercise.name
    this.exerciseMuscleInput.value = exercise.muscle
    this.exerciseSetsInput.value = exercise.sets.toString()
    this.exerciseRepsInput.value = exercise.reps.toString()
  }

  private wireEventHandlers() {
    this.deleteExerciseBtn.addEventListener('click', this.deleteExercise)
    this.exerciseForm.addEventListener('submit', this.handleSubmit)
  }

  private handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
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
      showErrorToast(error, 'Could not save exercise')
    }
  }

  private renderMusclePicker() {
    if (!this.musclePicker) {
      this.musclePicker = new MuscleGroupSelect('#exercise-muscle')
    }
    this.musclePicker.render({ includeOptionAll: false })
  }

  private deleteExercise = () => {
    if (!confirm('Are you sure you want to delete this exercise?')) {
      return
    }

    exercisesStore
      .softDeleteExercise(this.exerciseIdInput.value)
      .then(() => {
        this.closeDialog()
        Toasts.show({ message: 'Exercise deleted.' })
      })
      .catch((error) => {
        showErrorToast(error, 'Could not delete exercise')
      })
  }

  destroy() {
    super.destroy()

    this.deleteExerciseBtn.removeEventListener('click', this.deleteExercise)
    this.exerciseForm.removeEventListener('submit', this.handleSubmit)
  }
}

export default ExerciseDialog
