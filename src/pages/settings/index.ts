import { exportIndexedDbToJson } from '../../db/export';
import { importIndexedDbFromJson } from '../../db/import';
import '../../style.css';

const exportJsonBtn = document.querySelector('#export-json') as HTMLButtonElement
const importInput = document.querySelector('#import-input') as HTMLInputElement

exportJsonBtn.addEventListener('click', exportIndexedDbToJson)

importInput.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    importIndexedDbFromJson(file);
  }
})
