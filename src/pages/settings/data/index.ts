import { exportIndexedDbToJson } from '../../../db/export'
import { importIndexedDbFromJson } from '../../../db/import'
import { storage } from '../../../db/storage'
import Toasts from '../../../features/toasts'

// The data on this phone: export it to a JSON file, import one, or erase it all.
export const mount = () => {
  const exportJsonBtn = document.querySelector('#export-json') as HTMLButtonElement
  exportJsonBtn.addEventListener('click', exportIndexedDbToJson)

  const importInput = document.querySelector('#import-input') as HTMLInputElement
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    if (!file) return
    try {
      await importIndexedDbFromJson(file)
      Toasts.show({ message: 'Database imported!' })
    } catch (error) {
      Toasts.show({ message: 'Failed to import database.', type: 'error' })
      console.error('❌ Failed to import database', error)
    } finally {
      // The same file can be picked again.
      importInput.value = ''
    }
  })

  const resetDatabaseBtn = document.querySelector('#reset-database') as HTMLButtonElement
  resetDatabaseBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset the database?')) return
    try {
      await storage.deleteDatabase()
      Toasts.show({ message: 'Database reset.' })
    } catch (error) {
      console.error('reset failed', error)
      Toasts.show({ message: 'Close other tabs and try again.', type: 'error' })
    }
  })
}
