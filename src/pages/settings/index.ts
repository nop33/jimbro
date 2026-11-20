import { account } from '../../sync/account'
import { onPageNotice } from '../../sync/pageChannel'
import AppVersion from './AppVersion'
import { backupStatus } from './backupStatus'
import BreakTimeStepper from './BreakTimeStepper'
import { getFestive, getWatchReminder, storeFestive, storeWatchReminder } from '../../settings'
import { applySeason } from '../../features/season'

// Settings: the break time, the watch reminder and festive touches, set here, and rows that open the cloud backup, the AI assistants and the data on this
// phone, each on a page of its own, with the backup's status kept up to date as syncs settle.
export const mount = async (signal: AbortSignal) => {
  new BreakTimeStepper()
  new AppVersion(__BUILD__)

  // The reminder to start a watch as a workout starts, which "Don't remind me again" on gymtime turns off.
  const watchReminder = document.querySelector('#watch-reminder') as HTMLInputElement
  watchReminder.checked = getWatchReminder()
  watchReminder.addEventListener('change', () => storeWatchReminder(watchReminder.checked))

  // The Christmas decorations, which come and go at once.
  const festive = document.querySelector('#festive') as HTMLInputElement
  festive.checked = getFestive()
  festive.addEventListener('change', () => {
    storeFestive(festive.checked)
    applySeason()
  })

  const assistants = document.querySelector('#assistants-summary') as HTMLSpanElement
  assistants.textContent =
    account.current()?.method === 'passkey' ? 'Ask about your workouts' : 'Needs a passkey backup'

  const status = document.querySelector('#cloud-summary-status') as HTMLSpanElement
  const showStatus = async () => {
    status.textContent = await backupStatus()
  }
  onPageNotice(() => void showStatus(), signal)
  await showStatus()
}
