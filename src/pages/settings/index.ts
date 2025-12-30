import '../../style.css';
import { exportIndexedDbToJson } from '../../db/export';
import { importIndexedDbFromJson } from '../../db/import';
import { storage } from '../../db/storage';

const exportJsonBtn = document.querySelector('#export-json') as HTMLButtonElement
const importInput = document.querySelector('#import-input') as HTMLInputElement
const resetDatabaseBtn = document.querySelector('#reset-database') as HTMLButtonElement

exportJsonBtn.addEventListener('click', exportIndexedDbToJson)

importInput.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    importIndexedDbFromJson(file);
  }
})

resetDatabaseBtn.addEventListener('click', async () => {
  storage.deleteDatabase()
  console.log('✅ Database reset successfully')
})
