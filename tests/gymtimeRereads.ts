import type { Page } from '@playwright/test'

// The gymtime page rereads its open session when a pull changes it or another tab sends a notice, and changes the
// cards only when the session changed. While a reread, a write or the cards' update runs, the exercise list carries
// aria-busy. trackRereads counts the times the list turns busy from now on, through a MutationObserver, which records
// each change of the attribute however quickly it comes and goes. Once the list is no longer busy, a spec can check
// that the cards were left alone without sleeping first.
export const trackRereads = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('#exercises-list')
    if (!list) throw new Error('The gymtime page has no exercise list')
    const busy = { started: 0 }
    new MutationObserver((records) => {
      busy.started += records.filter(({ oldValue }) => oldValue === null).length
    }).observe(list, { attributeFilter: ['aria-busy'], attributeOldValue: true })
    Reflect.set(window, '__busy', busy)
  })

// Resolves once the list has turned busy at least `atLeast` times since trackRereads, and is no longer busy.
export const rereadsFinished = (page: Page, { atLeast = 0 } = {}) =>
  page.waitForFunction((atLeast) => {
    const busy = Reflect.get(window, '__busy') as { started: number }
    return busy.started >= atLeast && !document.querySelector('#exercises-list')?.hasAttribute('aria-busy')
  }, atLeast)
