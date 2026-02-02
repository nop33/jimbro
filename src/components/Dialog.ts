import { requireElement } from '../utils'

class Dialog {
  protected dialog: HTMLDialogElement
  private dialogCancel: HTMLButtonElement

  constructor(dialogSelector = 'dialog') {
    this.dialog = requireElement(dialogSelector)
    this.dialogCancel = requireElement('#dialog-cancel', this.dialog)
    this.dialogCancel.addEventListener('click', this.cancelHandler)
  }

  private cancelHandler = () => this.closeDialog()

  openDialog() {
    this.dialog.showModal()
  }

  closeDialog() {
    this.dialog.close()
  }

  destroy() {
    this.dialogCancel.removeEventListener('click', this.cancelHandler)
  }
}

export default Dialog
