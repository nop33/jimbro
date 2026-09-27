import { getCloudBackupConfig, storeCloudBackupConfig } from '../../db/cloudBackup'
import { OBJECT_STORES } from '../../db/constants'
import { storage } from '../../db/storage'
import Toasts from '../../features/toasts'
import { sync } from '../../sync/syncClient'
import { getLastSyncAt, isImportRequired } from '../../sync/status'

class CloudBackup {
  private static summaryStatus = document.querySelector('#cloud-summary-status') as HTMLSpanElement
  private static userIdInput = document.querySelector('#cloud-userid') as HTMLInputElement
  private static tokenInput = document.querySelector('#cloud-token') as HTMLInputElement
  private static saveBtn = document.querySelector('#cloud-save') as HTMLButtonElement
  private static syncNowBtn = document.querySelector('#cloud-sync-now') as HTMLButtonElement

  static init() {
    const existingConfig = getCloudBackupConfig()
    if (existingConfig) {
      this.userIdInput.value = existingConfig.userId
      this.tokenInput.value = existingConfig.token
    }

    void this.updateSummaryStatus()
    window.addEventListener('jimbro:sync-settled', () => {
      void this.updateSummaryStatus()
    })

    this.saveBtn.addEventListener('click', () => this.handleSave())
    this.syncNowBtn.addEventListener('click', () => void this.handleSync())
  }

  private static async updateSummaryStatus() {
    if (isImportRequired()) {
      this.summaryStatus.textContent = 'Cloud import has not been run yet'
      return
    }

    const config = getCloudBackupConfig()
    if (!config) {
      this.summaryStatus.textContent = 'Not set up yet'
      return
    }

    const pending = await storage.count(OBJECT_STORES.OUTBOX)
    const lastSync = getLastSyncAt()
    if (!lastSync) {
      this.summaryStatus.textContent = `${pending} pending`
      return
    }

    const formatted = new Date(lastSync).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    this.summaryStatus.textContent = `${pending} pending · ${formatted}`
  }

  private static handleSave() {
    const userId = this.userIdInput.value.trim()
    const token = this.tokenInput.value.trim()

    if (!userId || !token) {
      Toasts.show({ message: 'Please enter both User ID and Token.', type: 'warning' })
      return
    }

    storeCloudBackupConfig({ userId, token })
    Toasts.show({ message: 'Cloud backup credentials saved.' })
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
