import { pullDownToClose } from '../../../features/bottomSheet'

// Asks for the program's new name.
class RenameProgramDialog {
  private dialog = document.querySelector('#rename-program-dialog') as HTMLDialogElement
  private form = document.querySelector('#rename-program-form') as HTMLFormElement
  private nameInput = document.querySelector('#rename-program-name') as HTMLInputElement

  constructor(rename: (name: string) => void) {
    pullDownToClose(this.dialog)
    this.dialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => this.dialog.close())
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      const name = this.nameInput.value.trim()
      if (name) rename(name)
      this.dialog.close()
    })
  }

  // Opens on the name, ready to type over, since typing is all this dialog is for.
  open(name: string) {
    this.nameInput.value = name
    this.dialog.showModal()
    this.nameInput.select()
  }
}

export default RenameProgramDialog
