import { importIndexedDbFromJson } from '../../db/import'
import {
  getCloudBackupConfig,
  getLastBackupDate,
  storeCloudBackupConfig,
  uploadToCloud,
  restoreFromCloud
} from '../../db/cloudBackup'
import Toasts from '../../features/toasts'

class CloudBackup {
  private static details = document.querySelector('#cloud-backup-details') as HTMLDetailsElement
  private static summaryStatus = document.querySelector('#cloud-summary-status') as HTMLSpanElement
  private static userIdInput = document.querySelector('#cloud-userid') as HTMLInputElement
  private static tokenInput = document.querySelector('#cloud-token') as HTMLInputElement
  private static saveBtn = document.querySelector('#cloud-save') as HTMLButtonElement
  private static backupNowBtn = document.querySelector('#cloud-backup-now') as HTMLButtonElement
  private static restoreBtn = document.querySelector('#cloud-restore') as HTMLButtonElement

  static init() {
    const existingConfig = getCloudBackupConfig()
    if (existingConfig) {
      this.userIdInput.value = existingConfig.userId
      this.tokenInput.value = existingConfig.token
    }

    this.updateSummaryStatus()

    this.saveBtn.addEventListener('click', () => this.handleSave())
    this.backupNowBtn.addEventListener('click', () => this.handleBackup())
    this.restoreBtn.addEventListener('click', () => this.handleRestore())
  }

  private static updateSummaryStatus() {
    const config = getCloudBackupConfig()
    if (!config) {
      this.summaryStatus.textContent = 'Not set up yet'
      return
    }

    const lastDate = getLastBackupDate()
    if (lastDate) {
      const formatted = new Date(lastDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      this.summaryStatus.textContent = `${formatted}  ✅`
    } else {
      this.summaryStatus.textContent = 'No backup yet'
    }
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
    this.updateSummaryStatus()
  }

  private static async handleBackup() {
    if (!getCloudBackupConfig()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    try {
      this.summaryStatus.textContent = 'Uploading...'
      await uploadToCloud()
      Toasts.show({ message: 'Backup uploaded!' })
      this.updateSummaryStatus()
    } catch (error) {
      Toasts.show({ message: 'Backup failed.', type: 'error' })
      this.updateSummaryStatus()
      console.error('❌ Cloud backup failed', error)
    }
  }

  private static async handleRestore() {
    if (!getCloudBackupConfig()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    if (!confirm('This will merge cloud data into your local database. Continue?')) return

    try {
      this.summaryStatus.textContent = 'Restoring...'
      const response = await restoreFromCloud()
      const blob = await response.blob()
      const file = new File([blob], 'cloud-restore.json', { type: 'application/json' })
      await importIndexedDbFromJson(file)
      Toasts.show({ message: 'Restored from cloud!' })
      this.updateSummaryStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed.'
      Toasts.show({ message, type: 'error' })
      this.updateSummaryStatus()
      console.error('❌ Cloud restore failed', error)
    }
  }
}

export default CloudBackup
