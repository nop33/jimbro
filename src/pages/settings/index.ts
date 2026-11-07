import { account } from '../../sync/account'
import { onPageNotice } from '../../sync/pageChannel'
import AppVersion from './AppVersion'
import { backupStatus } from './backupStatus'
import BreakTimeStepper from './BreakTimeStepper'

// Settings: the break time, set here, and rows that open the cloud backup, the AI assistants and the data on this
// phone, each on a page of its own, with the backup's status kept up to date as syncs settle.
export const mount = async (signal: AbortSignal) => {
  new BreakTimeStepper()
  new AppVersion(__BUILD__)

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
