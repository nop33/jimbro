import { getCloudBackupConfig } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'
import { createPasskeyAccount, passkeysSupported, preparePasskey, signInWithPasskey } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { confirmReplaceWithAccount, showPasskeyFailure } from '../passkeyPrompts'
import { passkeyOfferDue, readSnoozedUntil, snoozePasskeyOffer } from './passkeyOffer'

// The offer to back up with a passkey that a finished workout shows under the exercises. It is a card in the page, not
// a dialog, so it never stands between the lifter and the workout.
class PasskeyOfferCard {
  private static card = document.querySelector('#passkey-offer') as HTMLElement
  private static createBtn = document.querySelector('#passkey-offer-create') as HTMLButtonElement
  private static dismissBtn = document.querySelector('#passkey-offer-dismiss') as HTMLButtonElement
  private static signInBtn = document.querySelector('#passkey-offer-sign-in') as HTMLButtonElement

  static init() {
    this.createBtn.addEventListener('click', () => void this.create())
    this.signInBtn.addEventListener('click', () => void this.signIn())
    this.dismissBtn.addEventListener('click', () => {
      snoozePasskeyOffer(new Date())
      this.card.hidden = true
    })
  }

  // Shows the card when the offer is due, and fetches the options its buttons need, so a tap opens the passkey sheet
  // right away.
  static offer() {
    if (!this.card.hidden) return
    const due = passkeyOfferDue({
      backup: getCloudBackupConfig()?.method ?? null,
      supported: passkeysSupported(),
      snoozedUntil: readSnoozedUntil(),
      now: new Date()
    })
    if (!due) return
    this.card.hidden = false
    preparePasskey('register')
    preparePasskey('signin')
  }

  private static async run(step: () => Promise<boolean>) {
    this.createBtn.disabled = true
    this.signInBtn.disabled = true
    try {
      return await step()
    } catch (error) {
      showPasskeyFailure(error)
      return false
    } finally {
      this.createBtn.disabled = false
      this.signInBtn.disabled = false
    }
  }

  private static async create() {
    const created = await this.run(async () => {
      await createPasskeyAccount()
      return true
    })
    if (!created) return
    this.card.hidden = true
    Toasts.show({ message: 'Passkey created. Your workouts are backing up.' })
    void sync().catch(() => undefined)
  }

  // Signing in restores the account's rows, which can replace what this page shows, so the page loads again after the
  // sync. This workout is only on this phone, so it stays and backs up.
  private static async signIn() {
    if (!(await this.run(() => signInWithPasskey({ confirmReplace: confirmReplaceWithAccount })))) return
    this.card.hidden = true
    Toasts.show({ message: 'Signed in. Restoring your workouts.' })
    await sync({ again: false }).catch(() => undefined)
    window.location.reload()
  }
}

export default PasskeyOfferCard
