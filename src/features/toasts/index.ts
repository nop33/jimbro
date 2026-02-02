import ToastMessagePopup from './ToastMessage'
import type { ToastMessage, ToastMessageSimple } from './toastsTypes'

class Toasts {
  private static messageQueue: Array<ToastMessage> = []
  private static currentlyDisplayingMessage: ToastMessage | null = null

  static show({ message, type = 'success', duration = 'short' }: ToastMessageSimple) {
    this.messageQueue.push({ message, type, duration })
    this.processQueue()
  }

  private static async processQueue() {
    if (this.messageQueue.length === 0 || this.currentlyDisplayingMessage) return

    this.currentlyDisplayingMessage = this.messageQueue.shift()!
    const toastMessagePopup = new ToastMessagePopup(this.currentlyDisplayingMessage)
    await toastMessagePopup.show()

    this.currentlyDisplayingMessage = null
    this.processQueue()
  }
}

export default Toasts

export const showErrorToast = (error: unknown, message: string) => {
  console.error('Error:', error)
  const errorMessage = error instanceof Error ? error.message : error
  Toasts.show({ message: `${message}: ${errorMessage}`, type: 'error' })
}
