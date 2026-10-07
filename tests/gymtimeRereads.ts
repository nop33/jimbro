import type { Page } from '@playwright/test'

// The gymtime page rereads its open session when a pull changes it or another tab sends a notice, and rebuilds the
// cards only when the session changed. A reread ends once any rebuild it started has landed, so a spec that counts
// them can check that the cards were left alone without sleeping first. trackRereads wraps the page's private
// refreshSession from the spec, so the app carries no hook for it.
export const trackRereads = (page: Page) =>
  page.evaluate(async () => {
    const { default: GymtimePage } = await import('/src/pages/gymtime/GymtimePage.ts')
    const reread: unknown = Reflect.get(GymtimePage, 'refreshSession')
    if (typeof reread !== 'function') throw new Error('GymtimePage.refreshSession is gone, so rereads go uncounted')
    const rereads = { started: 0, finished: 0 }
    Reflect.set(window, '__rereads', rereads)
    Reflect.set(GymtimePage, 'refreshSession', async () => {
      rereads.started += 1
      try {
        await reread.call(GymtimePage)
      } finally {
        rereads.finished += 1
      }
    })
  })

// Resolves once at least `atLeast` rereads have started since trackRereads, and every one that started has ended.
export const rereadsFinished = (page: Page, { atLeast = 0 } = {}) =>
  page.waitForFunction((atLeast) => {
    const { started, finished } = Reflect.get(window, '__rereads') as { started: number; finished: number }
    return started >= atLeast && finished === started
  }, atLeast)
