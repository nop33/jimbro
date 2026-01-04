import type { Exercise } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import ProgramExercisesMultiselect from './ProgramExercisesMultiselect'
import ProgramExercisesSortableList from './ProgramExercisesSortableList'

class ProgramDialog {
  private static newProgramButton = document.querySelector('#new-program-btn') as HTMLButtonElement
  private static programDialog = document.querySelector('#program-dialog') as HTMLDialogElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private static programForm = document.querySelector('#program-form') as HTMLFormElement
  private static programIdInput = document.querySelector('#program-id') as HTMLInputElement
  private static dialogTitle = document.querySelector('#dialog-title') as HTMLHeadingElement
  private static deleteProgramBtn = document.querySelector('#delete-program-btn') as HTMLButtonElement

  private static programExercisesMultiselect = new ProgramExercisesMultiselect('#exercises-selection')
  private static programExercisesSortableList = new ProgramExercisesSortableList('#selected-exercises-list')

  private static selectedExercises = new Set<Exercise['id']>()

  static openDialog() {
    this.programDialog.showModal()
  }

  static closeDialog() {
    this.programDialog.close()
  }

  static init() {
    this.programExercisesMultiselect.on('exercise-selected', ({ detail: { selectedExerciseIds } }) => {
      selectedExerciseIds.forEach((id) => this.selectedExercises.add(id))
      const selectedExercises = Array.from(this.selectedExercises)
      selectedExercises.forEach((id) => {
        if (!selectedExerciseIds.includes(id)) {
          this.selectedExercises.delete(id)
        }
      })
      this.programExercisesSortableList.render({ selectedExercises: this.selectedExercises })
    })

    this.programExercisesSortableList.on('reordered-exercises', ({ detail: { reorderedExerciseIds } }) => {
      this.selectedExercises = new Set(reorderedExerciseIds)
    })

    this.deleteProgramBtn.addEventListener('click', () => {
      this.deleteProgram()
    })

    this.newProgramButton.addEventListener('click', () => {
      this.render()
      this.openDialog()
    })

    this.dialogCancel.addEventListener('click', () => {
      this.closeDialog()
    })

    this.programForm.addEventListener('submit', async (e) => {
      e.preventDefault()

      const formData = new FormData(this.programForm)
      const id = this.programIdInput.value
      const name = formData.get('name') as string
      const exercises = Array.from(this.selectedExercises)

      try {
        if (id) {
          await programsStore.updateProgram({ id, name, exercises })
        } else {
          await programsStore.createProgram({ name, exercises })
        }

        this.closeDialog()
        Toasts.show({ message: 'Program saved!' })
      } catch (error) {
        console.error('Error saving program:', error)
        Toasts.show({ message: `Could not save program: ${error}`, type: 'error' })
      }
    })
  }

  static render(program?: Program) {
    if (program) {
      this.selectedExercises = new Set(program.exercises)

      this.dialogTitle.textContent = 'Edit Program'
      this.deleteProgramBtn.classList.remove('hidden')
      this.programIdInput.value = program.id
      ;(document.querySelector('#program-name') as HTMLInputElement).value = program.name
    } else {
      this.selectedExercises.clear()
      this.dialogTitle.textContent = 'New Program'
      this.programForm.reset()
      this.programIdInput.value = ''
      this.deleteProgramBtn.classList.add('hidden')
    }

    this.programExercisesMultiselect.render({ selectedExercises: this.selectedExercises })
    this.programExercisesSortableList.render({ selectedExercises: this.selectedExercises })
  }

  static deleteProgram() {
    if (confirm('Are you sure you want to delete this program?')) {
      programsStore.softDeleteProgram(this.programIdInput.value)
      this.closeDialog()
      Toasts.show({ message: 'Program deleted.' })
    }
  }
}

export default ProgramDialog
