import { formatShortDate } from '../../dateUtils'
import Toasts from '../../features/toasts'
import { account } from '../../sync/account'
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
import { confirmReplaceWithAccount, confirmSignOut, showPasskeyFailure } from '../passkeyPrompts'
import { whileBusy } from '../busyButton'

// Cloud Backup: the passkey offer while no passkey backs this device up, the account once one does, and the manual
// user ID and token under "Use a token" for local runs, tests and MCP.
class CloudBackup {
  private static details = document.querySelector('#cloud-backup-details') as HTMLDetailsElement
  private static summaryStatus = document.querySelector('#cloud-summary-status') as HTMLSpanElement
  private static offer = document.querySelector('#passkey-offer') as HTMLElement
  private static unsupported = document.querySelector('#passkey-unsupported') as HTMLParagraphElement
  private static account = document.querySelector('#passkey-account') as HTMLParagraphElement
  private static accountActions = document.querySelector('#passkey-account-actions') as HTMLDivElement
  private static tokenDetails = document.querySelector('#cloud-token-details') as HTMLDetailsElement
  private static createBtn = document.querySelector('#create-passkey') as HTMLButtonElement
  private static signInBtn = document.querySelector('#sign-in-passkey') as HTMLButtonElement
  private static addBtn = document.querySelector('#add-passkey') as HTMLButtonElement
  private static signOutBtn = document.querySelector('#sign-out-passkey') as HTMLButtonElement
  private static userIdInput = document.querySelector('#cloud-userid') as HTMLInputElement
  private static tokenInput = document.querySelector('#cloud-token') as HTMLInputElement
  private static saveBtn = document.querySelector('#cloud-save') as HTMLButtonElement
  private static syncNowBtn = document.querySelector('#cloud-sync-now') as HTMLButtonElement

  static init() {
    const saved = account.current()
    if (saved?.method === 'token') {
      this.userIdInput.value = saved.userId
      this.tokenInput.value = saved.token
    }

    this.showState()
    void this.updateSummaryStatus()
    onPageNotice(() => {
      void this.updateSummaryStatus()
    })

    // The passkey buttons show once the section opens, so that is when their options are fetched.
    this.details.addEventListener('toggle', () => this.prepare())
    this.createBtn.addEventListener('click', () => void this.handleCreate())
    this.signInBtn.addEventListener('click', () => void this.handleSignIn())
    this.addBtn.addEventListener('click', () => void this.handleAddPasskey())
    this.signOutBtn.addEventListener('click', () => void this.handleSignOut())
    this.saveBtn.addEventListener('click', () => void this.handleSave())
    this.syncNowBtn.addEventListener('click', () => void this.handleSync())
  }

  private static prepare() {
    if (!this.details.open || !passkeysSupported()) return
    if (account.current()?.method === 'passkey') {
      preparePasskey('add')
      return
    }
    preparePasskey('register')
    preparePasskey('signin')
  }

  // Shows what fits the saved account: the account for a passkey, else the offer and the token form. A device that
  // signed out offers signing in first.
  private static showState() {
    const config = account.current()
    const passkey = config?.method === 'passkey'
    const supported = passkeysSupported()
    this.offer.hidden = passkey || !supported
    this.unsupported.hidden = passkey || supported
    this.account.hidden = !passkey
    this.accountActions.hidden = !passkey
    this.addBtn.hidden = !supported
    this.tokenDetails.hidden = passkey
    this.syncNowBtn.hidden = config === null

    const signInFirst = account.signedOut()
    this.signInBtn.classList.toggle('btn-primary', signInFirst)
    this.signInBtn.classList.toggle('btn-secondary', !signInFirst)
    this.createBtn.classList.toggle('btn-primary', !signInFirst)
    this.createBtn.classList.toggle('btn-secondary', signInFirst)
    if (signInFirst) this.createBtn.before(this.signInBtn)
    else this.signInBtn.before(this.createBtn)
  }

  private static async updateSummaryStatus() {
    if (!account.current()) {
      this.summaryStatus.textContent = 'Not set up yet'
      return
    }

    const pending = await outbox.pending()
    const { lastSyncAt: lastSync, problem } = account.status()
    if (problem === 'row_limit') {
      this.summaryStatus.textContent = `Backup full · ${pending} pending`
      return
    }
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

  // Switches to the typed account, as a passkey sign-in does, so the next sync restores it and backs this device up
  // to it.
  private static async handleSave() {
    const userId = this.userIdInput.value.trim()
    const token = this.tokenInput.value.trim()

    if (!userId || !token) {
      Toasts.show({ message: 'Please enter both User ID and Token.', type: 'warning' })
      return
    }

    try {
      await account.switchTo({ userId, token, method: 'token' })
    } catch (error) {
      console.error('saving credentials failed', error)
      Toasts.show({ message: 'Could not save the credentials. Try again.', type: 'error' })
      return
    }
    Toasts.show({ message: 'Cloud backup credentials saved.' })
    this.showState()
    await this.handleSync()
  }

  private static async handleSync() {
    if (!account.current()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    try {
      this.summaryStatus.textContent = 'Syncing...'
      await sync()
      await this.updateSummaryStatus()
    } catch (error) {
      const full = account.status().problem === 'row_limit'
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
