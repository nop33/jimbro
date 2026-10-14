import { account } from '../../sync/account'
import Toasts from '../../features/toasts'
import { createPasskeyAccount, passkeysSupported, preparePasskey, signInWithPasskey } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { whileBusy } from '../busyButton'
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
      backup: account.current()?.method ?? null,
      supported: passkeysSupported(),
      snoozedUntil: readSnoozedUntil(),
      now: new Date()
    })
    if (!due) return
    this.card.hidden = false
    preparePasskey('register')
    preparePasskey('signin')
  }

  // Runs a passkey step while its button shows it is working, and resolves to whether it went through.
  private static async run(button: HTMLButtonElement, label: string, step: () => Promise<boolean>) {
    const beside = button === this.createBtn ? this.signInBtn : this.createBtn
    try {
      return await whileBusy(button, label, step, [beside, this.dismissBtn])
    } catch (error) {
      showPasskeyFailure(error)
      return false
    }
  }

  private static async create() {
    const created = await this.run(this.createBtn, 'Creating…', async () => {
      await createPasskeyAccount()
      return true
    })
    if (!created) return
    this.card.hidden = true
    Toasts.show({ message: 'Passkey created. Your workouts are backing up.' })
    void sync().catch(() => undefined)
  }

  // Signing in restores the account's rows, which can replace what this page shows, so the page loads again after.
  // This workout is only on this phone, so it stays and backs up.
  private static async signIn() {
    const signedIn = await this.run(this.signInBtn, 'Signing in…', async () => {
      if (!(await signInWithPasskey({ confirmReplace: confirmReplaceWithAccount }))) return false
      await sync({ again: false }).catch(() => undefined)
      return true
    })
    if (signedIn) window.location.reload()
  }
}

export default PasskeyOfferCard
