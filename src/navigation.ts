import { sync } from './sync/syncClient'
import { onPageNotice } from './sync/pageChannel'
import { isOutOfDate } from './sync/freshness'

let rowsWrittenTimer = 0

const startSync = () => {
  void sync().catch(() => undefined)
}

export function initNavigation() {
  document.querySelector('#back-button')?.addEventListener('click', () => {
    window.history.back()
  })

  // The service worker caches every page and asset, so the app opens offline. The dev server has no build to cache.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => console.error('Service worker failed:', error))
  }

  startSync()
  // Back and Forward restore the page as it was left. When the database changed meanwhile, load it fresh instead.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    void isOutOfDate().then((outOfDate) => (outOfDate ? window.location.reload() : startSync()))
  })
  window.addEventListener('online', startSync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startSync()
  })
  // The tabs share one outbox, so only the tab that wrote schedules a push.
  onPageNotice((notice, source) => {
    if (notice !== 'rows-written' || source !== 'this-tab') return
    window.clearTimeout(rowsWrittenTimer)
    rowsWrittenTimer = window.setTimeout(startSync, 2000)
  })
}

document.addEventListener('DOMContentLoaded', initNavigation)
