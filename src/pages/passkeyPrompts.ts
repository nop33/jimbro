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

// Asks before signing in replaces rows on this device: the account's copy wins for every row both sides have.
export const confirmReplaceWithAccount = () =>
  confirm(
    "Since both this device and your account have data that differs, signing in will replace this device's copy with your account's. Proceed to sign in?"
  )

// Asks before a sign-out, saying what the backup misses when rows wait to sync.
export const confirmSignOut = (pending: number) =>
  confirm(
    pending > 0
      ? `${pending} ${pending === 1 ? 'change' : 'changes'} on this phone ${pending === 1 ? "hasn't" : "haven't"} backed up yet. If you sign out now, the backup never gets ${pending === 1 ? 'it' : 'them'}, and signing in again replaces ${pending === 1 ? 'it' : 'them'} with the backup's copy. Sign out anyway?`
      : 'Sign out? Your workouts stay on this phone, and stop backing up.'
  )
