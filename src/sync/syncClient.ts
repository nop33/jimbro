import { storage } from '../db/storage'
import { account } from './account'
import { pushLock } from './outbox'
import { announce } from './pageChannel'
import { httpServer } from './server'
import { createSync } from './syncEngine'

let leaving = false

window.addEventListener('pagehide', () => {
  leaving = true
})
// A page restored from the back/forward cache syncs again.
window.addEventListener('pageshow', () => {
  leaving = false
})

// The app's sync: the saved account's worker over HTTP, for the page that runs it.
export const { sync } = createSync({
  storage,
  accounts: account,
  server: httpServer,
  lock: pushLock,
  page: { announce, leaving: () => leaving }
})
