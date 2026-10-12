import { formatShortDate } from '../../dateUtils'
import { getCloudBackupConfig, storeCloudBackupConfig } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'
import { outbox } from '../../sync/outbox'
import { addPasskey, createPasskeyAccount, passkeysSupported, signInWithPasskey, signOut } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { onPageNotice } from '../../sync/pageChannel'
import { getLastSyncAt } from '../../sync/status'
import { showPasskeyFailure } from '../passkeyFailure'

// Cloud Backup: the passkey offer while no passkey backs this device up, the account once one does, and the manual
// user ID and token under "Use a token" for local runs, tests and MCP.
class CloudBackup {
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
    const existingConfig = getCloudBackupConfig()
    if (existingConfig?.method === 'token') {
      this.userIdInput.value = existingConfig.userId
      this.tokenInput.value = existingConfig.token
    }

    this.showState()
    void this.updateSummaryStatus()
    onPageNotice(() => {
      void this.updateSummaryStatus()
    })

    this.createBtn.addEventListener('click', () => void this.runPasskeyStep(createPasskeyAccount, 'Passkey created.'))
    this.signInBtn.addEventListener('click', () => void this.runPasskeyStep(signInWithPasskey, 'Signed in.'))
    this.addBtn.addEventListener('click', () => void this.handleAddPasskey())
    this.signOutBtn.addEventListener('click', () => void this.handleSignOut())
    this.saveBtn.addEventListener('click', () => this.handleSave())
    this.syncNowBtn.addEventListener('click', () => void this.handleSync())
  }

  // Shows what fits the saved credentials: the account for a passkey, else the offer and the token form.
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
  }

  private static async updateSummaryStatus() {
    const config = getCloudBackupConfig()
    if (!config) {
      this.summaryStatus.textContent = 'Not set up yet'
      return
    }

    const pending = await outbox.pending()
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

  // Signs up or signs in, then syncs, which backs this device up to the account and restores the account's rows.
  private static async runPasskeyStep(step: () => Promise<void>, done: string) {
    this.createBtn.disabled = true
    this.signInBtn.disabled = true
    try {
      await step()
    } catch (error) {
      showPasskeyFailure(error)
      return
    } finally {
      this.createBtn.disabled = false
      this.signInBtn.disabled = false
    }
    Toasts.show({ message: done })
    this.showState()
    await this.handleSync()
  }

  private static async handleAddPasskey() {
    this.addBtn.disabled = true
    try {
      await addPasskey()
      Toasts.show({ message: 'Passkey added.' })
    } catch (error) {
      showPasskeyFailure(error)
    } finally {
      this.addBtn.disabled = false
    }
  }

  private static async handleSignOut() {
    if (!confirm('Sign out? Your workouts stay on this phone, and stop backing up.')) return
    try {
      await signOut()
    } catch (error) {
      console.error('sign out failed', error)
      Toasts.show({ message: 'Could not sign out. Try again when online.', type: 'error' })
      return
    }
    Toasts.show({ message: 'Signed out.' })
    this.showState()
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
      Toasts.show({ message: 'Sync failed.', type: 'error' })
      await this.updateSummaryStatus()
      console.error('sync failed', error)
    }
  }
}

export default CloudBackup
