import '../../style.css'
import { exportIndexedDbToJson } from '../../db/export'
import { importIndexedDbFromJson } from '../../db/import'
import { storage } from '../../db/storage'
import Toasts from '../../features/toasts'
import { getBreakTimeSeconds, storeBreakTimeSeconds } from '../../settings'
import CloudBackup from './CloudBackup'

CloudBackup.init()

const breakMinutesInput = document.querySelector('#break-minutes') as HTMLInputElement
const breakSecondsInput = document.querySelector('#break-seconds') as HTMLInputElement
const saveBreakTimeBtn = document.querySelector('#save-break-time') as HTMLButtonElement

if (breakMinutesInput && breakSecondsInput && saveBreakTimeBtn) {
  const currentBreakTime = getBreakTimeSeconds()
  breakMinutesInput.value = Math.floor(currentBreakTime / 60).toString()
  breakSecondsInput.value = (currentBreakTime % 60).toString()

  saveBreakTimeBtn.addEventListener('click', () => {
    const minutes = parseInt(breakMinutesInput.value, 10) || 0
    const seconds = parseInt(breakSecondsInput.value, 10) || 0
    const totalSeconds = minutes * 60 + seconds

    if (totalSeconds < 0) {
      Toasts.show({ message: 'Break time cannot be negative.', type: 'error' })
      return
    }

    storeBreakTimeSeconds(totalSeconds)
    Toasts.show({ message: 'Break time saved!', type: 'success' })
  })
}

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
