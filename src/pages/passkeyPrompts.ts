import Toasts from '../features/toasts'

// Tells the user why a passkey step failed: the browser's own sheet was closed or timed out, the passkey already
// exists, or the request failed.
export const showPasskeyFailure = (error: unknown) => {
  console.error('passkey failed', error)
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    Toasts.show({ message: 'No passkey was used.', type: 'warning' })
    return
  }
  if (error instanceof DOMException && error.name === 'InvalidStateError') {
    Toasts.show({ message: 'This phone already has a passkey for this account.', type: 'warning' })
    return
  }
  Toasts.show({ message: 'Passkey failed. Try again.', type: 'error' })
}
