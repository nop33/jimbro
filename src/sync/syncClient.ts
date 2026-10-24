import { clearCloudBackupConfig, getCloudBackupConfig, markSignedOut } from '../db/cloudBackup'
import { storage } from '../db/storage'
import { pushLock } from './outbox'
import { announce } from './pageChannel'
import { httpServer, SyncRequestError } from './server'
import { clearLastSyncAt, setLastSyncAt, setSyncProblem } from './status'
import { createSync } from './syncEngine'

let leaving = false

window.addEventListener('pagehide', () => {
  leaving = true
})
// A page restored from the back/forward cache syncs again.
window.addEventListener('pageshow', () => {
  leaving = false
})

// The app's sync: the worker over HTTP, for the page that runs it.
export const { sync } = createSync({
  storage,
  server: httpServer,
  lock: pushLock,
  page: {
    announce,
    synced: (at) => {
      setLastSyncAt(at)
      setSyncProblem(null)
    },
    // A full backup refuses every push from now on, so the pages say so instead of failing quietly. A passkey token the
    // worker no longer knows means a sign-in on another device moved the account there, since signing out here forgets
    // the credentials first. This device then stops syncing, keeps its data, and offers signing in to move it back.
    failed: (error) => {
      if (!(error instanceof SyncRequestError)) return
      if (error.code === 'row_limit') setSyncProblem('row_limit')
      if (error.status === 401 && getCloudBackupConfig()?.method === 'passkey') {
        clearCloudBackupConfig()
        markSignedOut(true)
        clearLastSyncAt()
        setSyncProblem('moved')
      }
    },
    leaving: () => leaving
  }
})
