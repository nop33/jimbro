import type { Exercise } from '../../db/stores/exercisesStore'
import { programsStore, type Program } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import ProgramExercisesMultiselect from './ProgramExercisesMultiselect'
import ProgramExercisesSortableList from './ProgramExercisesSortableList'

class ProgramDialog {
  private newProgramButton = document.querySelector('#new-program-btn') as HTMLButtonElement
  private programDialog = document.querySelector('#program-dialog') as HTMLDialogElement
  private programForm = document.querySelector('#program-form') as HTMLFormElement
  private programIdInput = document.querySelector('#program-id') as HTMLInputElement
  private programNameInput = document.querySelector('#program-name') as HTMLInputElement
  private dialogTitle = document.querySelector('#dialog-title') as HTMLHeadingElement
  private deleteProgramBtn = this.programDialog.querySelector('.delete-btn') as HTMLButtonElement

  private programExercisesMultiselect = new ProgramExercisesMultiselect('#exercises-selection')
  private programExercisesSortableList: ProgramExercisesSortableList

  private selectedExercises = new Set<Exercise['id']>()

  constructor(signal: AbortSignal) {
    this.programExercisesSortableList = new ProgramExercisesSortableList('#selected-exercises-list', signal)

    // The exercises still picked keep their order, and a newly picked one goes last.
    this.programExercisesMultiselect.on('exercise-selected', ({ detail: { selectedExerciseIds } }) => {
      const picked = new Set(selectedExerciseIds)
      for (const id of this.selectedExercises) if (!picked.has(id)) this.selectedExercises.delete(id)
      for (const id of picked) this.selectedExercises.add(id)
      this.programExercisesSortableList.render({ selectedExercises: this.selectedExercises })
    })

    this.programExercisesSortableList.on('reordered-exercises', ({ detail: { reorderedExerciseIds } }) => {
      this.selectedExercises = new Set(reorderedExerciseIds)
    })

    this.deleteProgramBtn.addEventListener('click', () => {
      void this.deleteProgram()
    })

    this.newProgramButton.addEventListener('click', () => this.open())

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

  // Opens on the program to edit, or on an empty form for a new one.
  open(program?: Program) {
    this.populateForm(program)
    this.programDialog.showModal()
  }

  private closeDialog() {
    this.programDialog.close()
  }

  private populateForm(program?: Program) {
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

  private async deleteProgram() {
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
