import { sync } from './sync/syncClient'
import { onPageNotice } from './sync/pageChannel'
import { isOutOfDate } from './sync/freshness'
import { getSyncProblem } from './sync/status'
import Toasts from './features/toasts'
import { PROBLEM_MESSAGES } from './pages/syncProblems'

let rowsWrittenTimer = 0
let toldProblem = false

// A failed sync retries on the next trigger. A full backup never takes a push again, and a backup that moved to another
// device stops this one syncing, so the page says so, once.
const startSync = () => {
  void sync().catch(() => {
    const problem = getSyncProblem()
    if (toldProblem || !problem) return
    toldProblem = true
    Toasts.show({ message: PROBLEM_MESSAGES[problem], type: 'error', duration: 'long' })
  })
}

export function initNavigation() {
  // The back button comes with each page the router shows, so one listener on the document serves them all.
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('#back-button')) window.history.back()
  })

  // The service worker caches every page and asset, so the app opens offline. The dev server has no build to cache.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => console.error('Service worker failed:', error))
  }

  // A page Back or Forward restored, or one prerendered before the tap, shows the database as it was then. When it
  // changed meanwhile, the page loads fresh instead.
  const showOrReload = () =>
    void isOutOfDate().then((outOfDate) => (outOfDate ? window.location.reload() : startSync()))
  // A prerendered page waits for the tap before it syncs, so only the page on screen syncs.
  if (document.prerendering) document.addEventListener('prerenderingchange', showOrReload, { once: true })
  else startSync()
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) showOrReload()
  })
  window.addEventListener('online', startSync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startSync()
  })
  onPageNotice((notice) => {
    if (notice !== 'rows-written') return
    window.clearTimeout(rowsWrittenTimer)
    rowsWrittenTimer = window.setTimeout(startSync, 2000)
  })
}

document.addEventListener('DOMContentLoaded', initNavigation)
