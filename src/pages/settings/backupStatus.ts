import { formatShortDate } from '../../dateUtils'
import { account } from '../../sync/account'
import { outbox } from '../../sync/outbox'

// The cloud backup's state in a few words, which the Settings row and the Cloud backup page both show: whether it is
// set up, what still waits to go, and when it last synced.
export const backupStatus = async (): Promise<string> => {
  const { lastSyncAt, problem } = account.status()
  if (!account.current()) return problem === 'moved' ? 'Moved to another device' : 'Not set up yet'

  const pending = await outbox.pending()
  if (problem === 'row_limit') return `Backup full · ${pending} pending`
  if (!lastSyncAt) return `${pending} pending`

  const lastSync = new Date(lastSyncAt)
  const time = lastSync.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${pending} pending · ${formatShortDate(lastSync)}, ${time}`
}
