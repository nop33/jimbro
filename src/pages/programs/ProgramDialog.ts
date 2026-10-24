import type { Exercise } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import ProgramExercisesMultiselect from './ProgramExercisesMultiselect'
import ProgramExercisesSortableList from './ProgramExercisesSortableList'

class ProgramDialog {
  private static get newProgramButton() {
    return document.querySelector('#new-program-btn') as HTMLButtonElement
  }
  private static get programDialog() {
    return document.querySelector('#program-dialog') as HTMLDialogElement
  }
  private static get programForm() {
    return document.querySelector('#program-form') as HTMLFormElement
  }
  private static get programIdInput() {
    return document.querySelector('#program-id') as HTMLInputElement
  }
  private static get programNameInput() {
    return document.querySelector('#program-name') as HTMLInputElement
  }
  private static get dialogTitle() {
    return document.querySelector('#dialog-title') as HTMLHeadingElement
  }
  private static get deleteProgramBtn() {
    return this.programDialog.querySelector('.delete-btn') as HTMLButtonElement
  }

  private static programExercisesMultiselect: ProgramExercisesMultiselect
  private static programExercisesSortableList: ProgramExercisesSortableList

  private static selectedExercises = new Set<Exercise['id']>()

  static openDialog() {
    this.programDialog.showModal()
  }

  static closeDialog() {
    this.programDialog.close()
  }

  static init() {
    this.programExercisesMultiselect = new ProgramExercisesMultiselect('#exercises-selection')
    this.programExercisesSortableList = new ProgramExercisesSortableList('#selected-exercises-list')
    this.selectedExercises = new Set()
    this.programExercisesMultiselect.on('exercise-selected', ({ detail: { selectedExerciseIds } }) => {
      const selectedIdsSet = new Set(selectedExerciseIds)
      selectedExerciseIds.forEach((id) => this.selectedExercises.add(id))
      const currentSelectedExercises = Array.from(this.selectedExercises)
      currentSelectedExercises.forEach((id) => {
        if (!selectedIdsSet.has(id)) {
          this.selectedExercises.delete(id)
        }
      })
      this.programExercisesSortableList.render({ selectedExercises: this.selectedExercises })
    })

    this.programExercisesSortableList.on('reordered-exercises', ({ detail: { reorderedExerciseIds } }) => {
      this.selectedExercises = new Set(reorderedExerciseIds)
    })

    this.deleteProgramBtn.addEventListener('click', () => {
      void this.deleteProgram()
    })

    this.newProgramButton.addEventListener('click', () => {
      this.populateForm()
      this.openDialog()
    })

    this.programDialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => {
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
          const existing = programsStore.find(id)
          if (!existing) throw new Error('Program not found')
          await programsStore.update({ ...existing, name, exercises })
        } else {
          await programsStore.create({ name, exercises })
        }

        this.closeDialog()
        Toasts.show({ message: 'Program saved!' })
      } catch (error) {
        console.error('Error saving program:', error)
        Toasts.show({ message: `Could not save program: ${String(error)}`, type: 'error' })
      }
    })
  }

  static populateForm(program?: Program) {
    // As in the exercise dialog: a new program opens on its name, an edited one on its title.
    this.programNameInput.autofocus = !program
    this.dialogTitle.autofocus = Boolean(program)

    if (program) {
      this.selectedExercises = new Set(program.exercises)

      this.dialogTitle.textContent = 'Edit Program'
      this.deleteProgramBtn.hidden = false
      this.programIdInput.value = program.id
      this.programNameInput.value = program.name
    } else {
      this.selectedExercises.clear()
      this.dialogTitle.textContent = 'New Program'
      this.programForm.reset()
      this.programIdInput.value = ''
      this.deleteProgramBtn.hidden = true
    }

    this.programExercisesMultiselect.render({ selectedExercises: this.selectedExercises })
    this.programExercisesSortableList.render({ selectedExercises: this.selectedExercises })
  }

  private static async deleteProgram() {
    if (confirm('Are you sure you want to delete this program?')) {
      try {
        await programsStore.remove(this.programIdInput.value)
        this.closeDialog()
        Toasts.show({ message: 'Program deleted.' })
      } catch (error) {
        console.error('Error deleting program:', error)
        Toasts.show({ message: `Could not delete program: ${String(error)}`, type: 'error' })
      }
    }
  }
}

export default ProgramDialog
