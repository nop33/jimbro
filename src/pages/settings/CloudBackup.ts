import { importIndexedDbFromJson } from '../../db/import'
import { getCloudBackupConfig, storeCloudBackupConfig, uploadToCloud, restoreFromCloud } from '../../db/cloudBackup'
import Toasts from '../../features/toasts'

class CloudBackup {
  private static userIdInput = document.querySelector('#cloud-userid') as HTMLInputElement
  private static tokenInput = document.querySelector('#cloud-token') as HTMLInputElement
  private static saveBtn = document.querySelector('#cloud-save') as HTMLButtonElement
  private static backupNowBtn = document.querySelector('#cloud-backup-now') as HTMLButtonElement
  private static restoreBtn = document.querySelector('#cloud-restore') as HTMLButtonElement
  private static status = document.querySelector('#cloud-status') as HTMLParagraphElement

  static init() {
    const existingConfig = getCloudBackupConfig()
    if (existingConfig) {
      this.userIdInput.value = existingConfig.userId
      this.tokenInput.value = existingConfig.token
      this.status.textContent = 'Credentials saved.'
    }

    this.saveBtn.addEventListener('click', () => this.handleSave())
    this.backupNowBtn.addEventListener('click', () => this.handleBackup())
    this.restoreBtn.addEventListener('click', () => this.handleRestore())
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
    this.status.textContent = 'Credentials saved.'
  }

  private static async handleBackup() {
    if (!getCloudBackupConfig()) {
      Toasts.show({ message: 'Save your credentials first.', type: 'warning' })
      return
    }

    try {
      this.status.textContent = 'Uploading...'
      await uploadToCloud()
      Toasts.show({ message: 'Backup uploaded!' })
      this.status.textContent = `Last backup: ${new Date().toLocaleString()}`
    } catch (error) {
      Toasts.show({ message: 'Backup failed.', type: 'error' })
      this.status.textContent = 'Backup failed.'
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
      this.status.textContent = 'Restoring...'
      const response = await restoreFromCloud()
      const blob = await response.blob()
      const file = new File([blob], 'cloud-restore.json', { type: 'application/json' })
      await importIndexedDbFromJson(file)
      Toasts.show({ message: 'Restored from cloud!' })
      this.status.textContent = `Restored: ${new Date().toLocaleString()}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed.'
      Toasts.show({ message, type: 'error' })
      this.status.textContent = 'Restore failed.'
      console.error('❌ Cloud restore failed', error)
    }
  }
}

export default CloudBackup
