import { sync } from './sync/syncClient'
import { onPageNotice } from './sync/pageChannel'
import { isOutOfDate } from './sync/freshness'
import { account } from './sync/account'
import Toasts from './features/toasts'

let rowsWrittenTimer = 0
let toldBackupFull = false

// A failed sync retries on the next trigger. A full backup never takes a push again, so the page says so, once.
const startSync = () => {
  void sync().catch(() => {
    if (toldBackupFull || account.status().problem !== 'row_limit') return
    toldBackupFull = true
    Toasts.show({
      message: 'Your cloud backup is full. New changes stay on this phone.',
      type: 'error',
      duration: 'long'
    })
  })
}

export function initNavigation() {
  document.querySelector('#back-button')?.addEventListener('click', () => {
    window.history.back()
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
