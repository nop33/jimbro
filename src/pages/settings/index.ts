import '../../style.css'
import { exportIndexedDbToJson } from '../../db/export'
import { importIndexedDbFromJson } from '../../db/import'
import { storage } from '../../db/storage'
import Toasts from '../../features/toasts'
import CloudBackup from './CloudBackup'

CloudBackup.init()

const exportJsonBtn = document.querySelector('#export-json') as HTMLButtonElement
exportJsonBtn.addEventListener('click', exportIndexedDbToJson)

const importInput = document.querySelector('#import-input') as HTMLInputElement
importInput.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    try {
      await importIndexedDbFromJson(file)
      Toasts.show({ message: 'Database imported!' })
    } catch (error) {
      Toasts.show({ message: 'Failed to import database.', type: 'error' })
      console.error('❌ Failed to import database', error)
    }
  }
})

const resetDatabaseBtn = document.querySelector('#reset-database') as HTMLButtonElement
resetDatabaseBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to reset the database?')) {
    await storage.deleteDatabase()
    Toasts.show({ message: 'Database reset.' })
  }
})
