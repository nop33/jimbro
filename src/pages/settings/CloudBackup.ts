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
import { PROBLEM_MESSAGES } from '../syncProblems'
import { confirmSignIn, confirmSignOut, showPasskeyFailure } from '../passkeyPrompts'
import { whileBusy } from '../busyButton'

// Cloud Backup: the passkey offer while no passkey backs this device up, the account once one does, and the manual
// user ID and token under "Use a token" for local runs, tests and MCP.
class CloudBackup {
  // Aborts when the page goes, which stops the passkey options refreshing and the status following syncs.
  private signal: AbortSignal
  private details = document.querySelector('#cloud-backup-details') as HTMLDetailsElement
  private summaryStatus = document.querySelector('#cloud-summary-status') as HTMLSpanElement
  private offer = document.querySelector('#passkey-offer') as HTMLElement
  private moved = document.querySelector('#passkey-moved') as HTMLParagraphElement
  private unsupported = document.querySelector('#passkey-unsupported') as HTMLParagraphElement
  private accountInfo = document.querySelector('#passkey-account') as HTMLParagraphElement
  private accountActions = document.querySelector('#passkey-account-actions') as HTMLDivElement
  private tokenDetails = document.querySelector('#cloud-token-details') as HTMLDetailsElement
  private createBtn = document.querySelector('#create-passkey') as HTMLButtonElement
  private signInBtn = document.querySelector('#sign-in-passkey') as HTMLButtonElement
  private addBtn = document.querySelector('#add-passkey') as HTMLButtonElement
  private signOutBtn = document.querySelector('#sign-out-passkey') as HTMLButtonElement
  private userIdInput = document.querySelector('#cloud-userid') as HTMLInputElement
  private tokenInput = document.querySelector('#cloud-token') as HTMLInputElement
  private saveBtn = document.querySelector('#cloud-save') as HTMLButtonElement
  private syncNowBtn = document.querySelector('#cloud-sync-now') as HTMLButtonElement

  constructor(signal: AbortSignal) {
    this.signal = signal
    const saved = account.current()
    if (saved?.method === 'token') {
      this.userIdInput.value = saved.userId
      this.tokenInput.value = saved.token
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
    this.saveBtn.addEventListener('click', () => void this.handleSave())
    this.syncNowBtn.addEventListener('click', () => void this.handleSync())
  }

  private prepare() {
    if (!this.details.open || !passkeysSupported()) return
    if (account.current()?.method === 'passkey') {
      preparePasskey('add', this.signal)
      return
    }
    preparePasskey('register', this.signal)
    preparePasskey('signin', this.signal)
  }

  // Shows what fits the saved account: the account for a passkey, else the offer and the token form. A device that
  // signed out offers signing in first.
  private showState() {
    const config = account.current()
    const passkey = config?.method === 'passkey'
    const supported = passkeysSupported()
    this.offer.hidden = passkey || !supported
    this.moved.hidden = passkey || account.status().problem !== 'moved'
    this.unsupported.hidden = passkey || supported
    this.accountInfo.hidden = !passkey
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

  private async updateSummaryStatus() {
    const { lastSyncAt: lastSync, problem } = account.status()
    if (!account.current()) {
      this.summaryStatus.textContent = problem === 'moved' ? 'Moved to another device' : 'Not set up yet'
      return
    }

    const pending = await outbox.pending()
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
  private async runPasskeyStep(button: HTMLButtonElement, label: string, step: () => Promise<boolean>, done: string) {
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

  private handleCreate() {
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
  private handleSignIn() {
    return this.runPasskeyStep(this.signInBtn, 'Signing in…', () => signInWithPasskey({ confirmSignIn }), 'Signed in.')
  }

  private async handleAddPasskey() {
    try {
      await whileBusy(this.addBtn, 'Adding passkey…', addPasskey)
      Toasts.show({ message: 'Passkey added.' })
    } catch (error) {
      showPasskeyFailure(error)
    }
  }

  // Backs up what waits first, and warns when some of it could not go.
  private async handleSignOut() {
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
  private async handleSave() {
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
    this.prepare()
    await this.handleSync()
  }

  private async handleSync() {
    if (!account.current()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    try {
      this.summaryStatus.textContent = 'Syncing...'
      await sync()
      await this.updateSummaryStatus()
    } catch (error) {
      const { problem } = account.status()
      Toasts.show({
        message: problem ? PROBLEM_MESSAGES[problem] : 'Sync failed.',
        type: 'error'
      })
      this.showState()
      this.prepare()
      await this.updateSummaryStatus()
      console.error('sync failed', error)
    }
  }
}

export default CloudBackup
