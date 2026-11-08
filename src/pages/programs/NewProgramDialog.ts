import { programsStore } from '../../db/stores/programsStore'
import Toasts from '../../features/toasts'
import { programPageUrl } from './programExercises'
import { pullDownToClose } from '../../features/bottomSheet'

// New asks only for a name. The program's page then opens on the exercise picker.
class NewProgramDialog {
  private dialog = document.querySelector('#new-program-dialog') as HTMLDialogElement
  private form = document.querySelector('#new-program-form') as HTMLFormElement
  private nameInput = document.querySelector('#new-program-name') as HTMLInputElement

  constructor() {
    pullDownToClose(this.dialog)
    ;(document.querySelector('#new-program-btn') as HTMLButtonElement).addEventListener('click', () => {
      this.form.reset()
      this.dialog.showModal()
    })
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.dialog.close())
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.create()
    })
  }

  private async create() {
    try {
      const program = await programsStore.create({ name: this.nameInput.value.trim(), exercises: [] })
      this.dialog.close()
      location.assign(`${programPageUrl(program.id)}&add`)
    } catch (error) {
      console.error('Error creating program:', error)
      Toasts.show({ message: `Could not create program: ${String(error)}`, type: 'error' })
    }
  }
}

export default NewProgramDialog
