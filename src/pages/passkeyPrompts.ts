import Toasts from '../features/toasts'
import type { SignInEffects } from '../sync/passkeys'

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

// Asks before a sign-in moves the account here from another device, or replaces rows on this device with the account's
// copy, which wins for every row both sides have.
export const confirmSignIn = ({ movesFromOtherDevice, replacesLocalRows }: SignInEffects) =>
  confirm(
    [
      movesFromOtherDevice
        ? "Your account is signed in on another device. Jimbro backs up one device at a time, so signing in here moves your backup to this device. The other device stops backing up and keeps its workouts, but anything it hasn't backed up yet won't come here."
        : '',
      replacesLocalRows
        ? "Since both this device and your account have data that differs, signing in will replace this device's copy with your account's."
        : '',
      movesFromOtherDevice ? 'Sign in here?' : 'Proceed to sign in?'
    ]
      .filter(Boolean)
      .join('\n\n')
  )

// Asks before a sign-out, saying what the backup misses when rows wait to sync.
export const confirmSignOut = (pending: number) =>
  confirm(
    pending > 0
      ? `${pending} ${pending === 1 ? 'change' : 'changes'} on this phone ${pending === 1 ? "hasn't" : "haven't"} backed up yet. If you sign out now, the backup never gets ${pending === 1 ? 'it' : 'them'}, and signing in again replaces ${pending === 1 ? 'it' : 'them'} with the backup's copy. Sign out anyway?`
      : 'Sign out? Your workouts stay on this phone, and stop backing up.'
  )
