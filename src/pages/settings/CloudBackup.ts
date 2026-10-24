import { formatShortDate } from '../../dateUtils'
import { getCloudBackupConfig, storeCloudBackupConfig, wasSignedOut } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'
import { outbox } from '../../sync/outbox'
import {
  addPasskey,
  backUpBeforeSignOut,
  createPasskeyAccount,
  passkeysSupported,
  preparePasskey,
  signInWithPasskey,
  signOut
} from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { onPageNotice } from '../../sync/pageChannel'
import { getLastSyncAt, getSyncProblem } from '../../sync/status'
import { confirmReplaceWithAccount, confirmSignOut, showPasskeyFailure } from '../passkeyPrompts'
import { whileBusy } from '../busyButton'

// Cloud Backup: the passkey offer while no passkey backs this device up, the account once one does, and the manual
// user ID and token under "Use a token" for local runs, tests and MCP.
class CloudBackup {
  private static get details() {
    return document.querySelector('#cloud-backup-details') as HTMLDetailsElement
  }
  private static get summaryStatus() {
    return document.querySelector('#cloud-summary-status') as HTMLSpanElement
  }
  private static get offer() {
    return document.querySelector('#passkey-offer') as HTMLElement
  }
  private static get unsupported() {
    return document.querySelector('#passkey-unsupported') as HTMLParagraphElement
  }
  private static get account() {
    return document.querySelector('#passkey-account') as HTMLParagraphElement
  }
  private static get accountActions() {
    return document.querySelector('#passkey-account-actions') as HTMLDivElement
  }
  private static get tokenDetails() {
    return document.querySelector('#cloud-token-details') as HTMLDetailsElement
  }
  private static get createBtn() {
    return document.querySelector('#create-passkey') as HTMLButtonElement
  }
  private static get signInBtn() {
    return document.querySelector('#sign-in-passkey') as HTMLButtonElement
  }
  private static get addBtn() {
    return document.querySelector('#add-passkey') as HTMLButtonElement
  }
  private static get signOutBtn() {
    return document.querySelector('#sign-out-passkey') as HTMLButtonElement
  }
  private static get userIdInput() {
    return document.querySelector('#cloud-userid') as HTMLInputElement
  }
  private static get tokenInput() {
    return document.querySelector('#cloud-token') as HTMLInputElement
  }
  private static get saveBtn() {
    return document.querySelector('#cloud-save') as HTMLButtonElement
  }
  private static get syncNowBtn() {
    return document.querySelector('#cloud-sync-now') as HTMLButtonElement
  }

  static init(signal: AbortSignal) {
    const existingConfig = getCloudBackupConfig()
    if (existingConfig?.method === 'token') {
      this.userIdInput.value = existingConfig.userId
      this.tokenInput.value = existingConfig.token
    }

    this.showState()
    void this.updateSummaryStatus()
    onPageNotice(() => {
      void this.updateSummaryStatus()
    }, signal)

    // The passkey buttons show once the section opens, so that is when their options are fetched.
    this.details.addEventListener('toggle', () => this.prepare())
    this.createBtn.addEventListener('click', () => void this.handleCreate())
    this.signInBtn.addEventListener('click', () => void this.handleSignIn())
    this.addBtn.addEventListener('click', () => void this.handleAddPasskey())
    this.signOutBtn.addEventListener('click', () => void this.handleSignOut())
    this.saveBtn.addEventListener('click', () => this.handleSave())
    this.syncNowBtn.addEventListener('click', () => void this.handleSync())
  }

  private static prepare() {
    if (!this.details.open || !passkeysSupported()) return
    if (getCloudBackupConfig()?.method === 'passkey') {
      preparePasskey('add')
      return
    }
    preparePasskey('register')
    preparePasskey('signin')
  }

  // Shows what fits the saved credentials: the account for a passkey, else the offer and the token form. A device that
  // signed out offers signing in first.
  private static showState() {
    const config = getCloudBackupConfig()
    const passkey = config?.method === 'passkey'
    const supported = passkeysSupported()
    this.offer.hidden = passkey || !supported
    this.unsupported.hidden = passkey || supported
    this.account.hidden = !passkey
    this.accountActions.hidden = !passkey
    this.addBtn.hidden = !supported
    this.tokenDetails.hidden = passkey
    this.syncNowBtn.hidden = config === null

    const signInFirst = wasSignedOut()
    this.signInBtn.classList.toggle('btn-primary', signInFirst)
    this.signInBtn.classList.toggle('btn-secondary', !signInFirst)
    this.createBtn.classList.toggle('btn-primary', !signInFirst)
    this.createBtn.classList.toggle('btn-secondary', signInFirst)
    if (signInFirst) this.createBtn.before(this.signInBtn)
    else this.signInBtn.before(this.createBtn)
  }

  private static async updateSummaryStatus() {
    const config = getCloudBackupConfig()
    if (!config) {
      this.summaryStatus.textContent = 'Not set up yet'
      return
    }

    const pending = await outbox.pending()
    if (getSyncProblem() === 'row_limit') {
      this.summaryStatus.textContent = `Backup full · ${pending} pending`
      return
    }
    const lastSync = getLastSyncAt()
    if (!lastSync) {
      this.summaryStatus.textContent = `${pending} pending`
      return
    }

    const lastSyncDate = new Date(lastSync)
    const time = lastSyncDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const formatted = `${formatShortDate(lastSyncDate)}, ${time}`
    this.summaryStatus.textContent = `${pending} pending · ${formatted}`
  }

  // Runs a sign-up or sign-in, then syncs, which backs this device up to the account and restores the account's rows.
  // Resolves to false when it did not switch the account.
  private static async runPasskeyStep(
    button: HTMLButtonElement,
    label: string,
    step: () => Promise<boolean>,
    done: string
  ) {
    const beside = button === this.createBtn ? this.signInBtn : this.createBtn
    try {
      if (!(await whileBusy(button, label, step, [beside]))) return
    } catch (error) {
      showPasskeyFailure(error)
      return
    }
    Toasts.show({ message: done })
    this.showState()
    this.prepare()
    await this.handleSync()
  }

  private static handleCreate() {
    return this.runPasskeyStep(
      this.createBtn,
      'Creating passkey…',
      async () => {
        await createPasskeyAccount()
        return true
      },
      'Passkey created.'
    )
  }

  // The sign-in restores the account before it resolves, so the button stays busy until the workouts are back.
  private static handleSignIn() {
    return this.runPasskeyStep(
      this.signInBtn,
      'Signing in…',
      () => signInWithPasskey({ confirmReplace: confirmReplaceWithAccount }),
      'Signed in.'
    )
  }

  private static async handleAddPasskey() {
    try {
      await whileBusy(this.addBtn, 'Adding passkey…', addPasskey)
      Toasts.show({ message: 'Passkey added.' })
    } catch (error) {
      showPasskeyFailure(error)
    }
  }

  // Backs up what waits first, and warns when some of it could not go.
  private static async handleSignOut() {
    this.signOutBtn.disabled = true
    this.summaryStatus.textContent = 'Syncing...'
    try {
      const pending = await backUpBeforeSignOut()
      await this.updateSummaryStatus()
      if (!confirmSignOut(pending)) return
      await signOut()
    } catch (error) {
      console.error('sign out failed', error)
      Toasts.show({ message: 'Could not sign out. Try again when online.', type: 'error' })
      return
    } finally {
      this.signOutBtn.disabled = false
    }
    Toasts.show({ message: 'Signed out.' })
    this.showState()
    this.prepare()
    await this.updateSummaryStatus()
  }

  private static handleSave() {
    const userId = this.userIdInput.value.trim()
    const token = this.tokenInput.value.trim()

    if (!userId || !token) {
      Toasts.show({ message: 'Please enter both User ID and Token.', type: 'warning' })
      return
    }

    storeCloudBackupConfig({ userId, token, method: 'token' })
    Toasts.show({ message: 'Cloud backup credentials saved.' })
    this.showState()
    void this.updateSummaryStatus()
  }

  private static async handleSync() {
    if (!getCloudBackupConfig()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    try {
      this.summaryStatus.textContent = 'Syncing...'
      await sync()
      await this.updateSummaryStatus()
    } catch (error) {
      const full = getSyncProblem() === 'row_limit'
      Toasts.show({
        message: full ? 'Your cloud backup is full. New changes stay on this phone.' : 'Sync failed.',
        type: 'error'
      })
      await this.updateSummaryStatus()
      console.error('sync failed', error)
    }
  }
}

export default CloudBackup
