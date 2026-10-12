import { storage } from '../db/storage'
import { pushLock } from './outbox'
import { announce } from './pageChannel'
import { httpServer, SyncRequestError } from './server'
import { setLastSyncAt, setSyncProblem } from './status'
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
    // A full backup refuses every push from now on, so the pages say so instead of failing quietly.
    failed: (error) => {
      if (error instanceof SyncRequestError && error.code === 'row_limit') setSyncProblem('row_limit')
    },
    leaving: () => leaving
  }
})
