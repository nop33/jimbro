import { storage } from '../db/storage'
import { pushLock } from './outbox'
import { announce } from './pageChannel'
import { httpServer } from './server'
import { setLastSyncAt } from './status'
import { createSync } from './syncEngine'

let leaving = false

window.addEventListener('pagehide', () => {
  leaving = true
})
// A page restored from the back/forward cache syncs again.
window.addEventListener('pageshow', () => {
  leaving = false
})

// The app's sync: the worker over HTTP, and the session in the page's ?id=, which only gymtime sets.
export const { sync } = createSync({
  storage,
  server: httpServer,
  lock: pushLock,
  page: {
    openSessionId: () => new URLSearchParams(window.location.search).get('id'),
    announce,
    synced: setLastSyncAt,
    leaving: () => leaving
  }
})
