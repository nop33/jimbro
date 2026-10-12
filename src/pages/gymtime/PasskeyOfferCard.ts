import { getCloudBackupConfig } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'
import { createPasskeyAccount, passkeysSupported } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { showPasskeyFailure } from '../passkeyFailure'
import { passkeyOfferDue, readSnoozedUntil, snoozePasskeyOffer } from './passkeyOffer'

// The offer to back up with a passkey that a finished workout shows under the exercises. It is a card in the page, not
// a dialog, so it never stands between the lifter and the workout.
class PasskeyOfferCard {
  private static card = document.querySelector('#passkey-offer') as HTMLElement
  private static createBtn = document.querySelector('#passkey-offer-create') as HTMLButtonElement
  private static dismissBtn = document.querySelector('#passkey-offer-dismiss') as HTMLButtonElement

  static init() {
    this.createBtn.addEventListener('click', () => void this.create())
    this.dismissBtn.addEventListener('click', () => {
      snoozePasskeyOffer(new Date())
      this.card.hidden = true
    })
  }

  // Shows the card when the offer is due.
  static offer() {
    const due = passkeyOfferDue({
      backup: getCloudBackupConfig()?.method ?? null,
      supported: passkeysSupported(),
      snoozedUntil: readSnoozedUntil(),
      now: new Date()
    })
    if (due) this.card.hidden = false
  }

  private static async create() {
    this.createBtn.disabled = true
    try {
      await createPasskeyAccount()
    } catch (error) {
      showPasskeyFailure(error)
      return
    } finally {
      this.createBtn.disabled = false
    }
    this.card.hidden = true
    Toasts.show({ message: 'Passkey created. Your workouts are backing up.' })
    void sync().catch(() => undefined)
  }
}

export default PasskeyOfferCard
