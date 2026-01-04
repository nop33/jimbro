import type { ToastMessage } from './toastsTypes'

class ToastMessagePopup {
  private toastMessage: ToastMessage

  constructor(toastMessage: ToastMessage) {
    this.toastMessage = toastMessage
  }

  render() {
    const toastMessagePopup = document.createElement('div')
    toastMessagePopup.classList.add('toast-message-popup')
    toastMessagePopup.classList.add(this.toastMessage.type)
    toastMessagePopup.innerHTML = this.toastMessage.message

    return toastMessagePopup
  }

  async show() {
    const toastMessagePopup = this.render()
    document.body.appendChild(toastMessagePopup)

    return new Promise((resolve) => {
      const dismiss = () => {
        toastMessagePopup.remove()
        resolve(undefined)
      }

      const timeout = setTimeout(dismiss, this.toastMessage.duration === 'short' ? 3000 : 5000)

      toastMessagePopup.addEventListener('click', () => {
        dismiss()
        clearTimeout(timeout)
      })
    })
  }
}

export default ToastMessagePopup
