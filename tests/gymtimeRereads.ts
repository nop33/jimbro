import type { Page } from '@playwright/test'

// The gymtime page rereads its open session when a pull changes it or another tab sends a notice, and rebuilds the
// cards only when the session changed. trackRereads counts the rereads and card rebuilds that start and end, by
// wrapping GymtimePage.refreshSession and ExerciseCardList.render from the spec, so the app carries no hook for it.
// Once none is running, a spec can check that the cards were left alone without sleeping first.
export const trackRereads = (page: Page) =>
  page.evaluate(async () => {
    const { default: GymtimePage } = await import('/src/pages/gymtime/GymtimePage.ts')
    const { default: ExerciseCardList } = await import('/src/pages/gymtime/ExerciseCardList.ts')
    // A class keeps what its init stored. A copy the dev server reloaded after an edit has nothing stored, and the
    // page never calls it, so wrapping it would count nothing.
    const track = (owner: object, storedByInit: string, method: string) => {
      const run: unknown = Reflect.get(owner, method)
      if (typeof run !== 'function') throw new Error(`${method} is gone, so the spec can't wait for it`)
      if (Reflect.get(owner, storedByInit) === undefined) throw new Error(`The page doesn't run this copy of ${method}`)
      const calls = { started: 0, finished: 0 }
      Reflect.set(owner, method, async () => {
        calls.started += 1
        try {
          await run.call(owner)
        } finally {
          calls.finished += 1
        }
      })
      return calls
    }
    Reflect.set(window, '__rereads', track(GymtimePage, 'program', 'refreshSession'))
    Reflect.set(window, '__rebuilds', track(ExerciseCardList, 'exercisesList', 'render'))
  })

type Calls = { started: number; finished: number }

// Resolves once at least `atLeast` rereads have started since trackRereads, and every reread and card rebuild that
// started has ended, whichever path started the rebuild.
export const rereadsFinished = (page: Page, { atLeast = 0 } = {}) =>
  page.waitForFunction((atLeast) => {
    const rereads = Reflect.get(window, '__rereads') as Calls
    const rebuilds = Reflect.get(window, '__rebuilds') as Calls
    return rereads.started >= atLeast && rereads.finished === rereads.started && rebuilds.finished === rebuilds.started
  }, atLeast)
