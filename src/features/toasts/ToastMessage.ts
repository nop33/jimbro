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
    toastMessagePopup.textContent = this.toastMessage.message

    return toastMessagePopup
  }

  async show() {
    const toastMessagePopup = this.render()
    document.body.appendChild(toastMessagePopup)

    return new Promise((resolve) => {
      // It slides out the way it came in, and the next toast waits until it has gone.
      const dismiss = async () => {
        toastMessagePopup.classList.add('leaving')
        // Reading a style applies the class now, so the transitions it starts are there to wait for.
        void getComputedStyle(toastMessagePopup).opacity
        await Promise.allSettled(toastMessagePopup.getAnimations().map(({ finished }) => finished))
        toastMessagePopup.remove()
        resolve(undefined)
      }

      const timeout = setTimeout(() => void dismiss(), this.toastMessage.duration === 'short' ? 3000 : 5000)

      toastMessagePopup.addEventListener(
        'click',
        () => {
          clearTimeout(timeout)
          void dismiss()
        },
        { once: true }
      )
    })
  }
}

export default ToastMessagePopup
