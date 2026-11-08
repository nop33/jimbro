/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { writeFile } from 'node:fs/promises'
import { test as base } from '@playwright/test'

export interface RouterOptions {
  // Whether the page gets the browser's Navigation API, which the router shows each page in the same document with.
  navigationApi: boolean
}

// Playwright's test, with the Navigation API taken away where a project sets navigationApi to false. Without it the
// router leaves every navigation to the browser, as in a browser that lacks the API, so each tap loads the next page in
// full. Specs import test from here, so the option reaches every page they open.
export const test = base.extend<RouterOptions>({
  navigationApi: [true, { option: true }],
  context: async ({ context, navigationApi }, use) => {
    if (!navigationApi) {
      await context.addInitScript(() => Object.defineProperty(globalThis, 'navigation', { value: undefined }))
    }
    await use(context)
  },
  // A failed test writes what the page logged and where it stood to diagnostics.txt in its output folder, which CI prints,
  // since a cloud session can neither download CI's report nor run WebKit.
  page: async ({ page }, use, testInfo) => {
    const log: string[] = []
    const at = () => `${(performance.now() / 1000).toFixed(2)}s`
    page.on('console', (message) => log.push(`${at()} console.${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => log.push(`${at()} pageerror: ${error.stack ?? error.message}`))
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) log.push(`${at()} navigated: ${frame.url()}`)
    })
    page.on('dialog', (dialog) => log.push(`${at()} dialog ${dialog.type()}: ${dialog.message()}`))
    // A page whose modules fail to load draws nothing, so the log names each request that failed and why.
    page.on('requestfailed', (request) =>
      log.push(`${at()} request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)
    )
    page.on('response', (response) => {
      if (response.status() >= 400) log.push(`${at()} response ${response.status()}: ${response.url()}`)
    })
    // The page logs the taps, submits and failed validations it sees, and the app's notices, with where they landed and
    // whether anything cancelled them, so a lost tap shows which step dropped it.
    await page.addInitScript(() => {
      const describe = (target: EventTarget | null) => {
        if (!(target instanceof Element))
          return target === window ? 'window' : target === document ? 'document' : 'other'
        const text = target.textContent?.trim().slice(0, 30) ?? ''
        return `${target.tagName.toLowerCase()}${target.className ? `.${String(target.className).split(' ')[0]}` : ''} "${text}"`
      }
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'submit', 'invalid']) {
        window.addEventListener(type, (event) => console.debug(`trace ${type} on ${describe(event.target)}`), true)
        window.addEventListener(type, (event) => {
          if (event.defaultPrevented) console.debug(`trace ${type} cancelled`)
        })
      }
      for (const notice of ['rows-written', 'sync-settled']) {
        window.addEventListener(`jimbro:${notice}`, () => console.debug(`trace ${notice}`))
      }
    })
    await use(page)
    if (testInfo.status === testInfo.expectedStatus) return
    const state = await page
      .evaluate(() => ({
        url: location.href,
        visibility: document.visibilityState,
        focused: document.activeElement?.outerHTML.slice(0, 200),
        busy: document.querySelector('[aria-busy]')?.id,
        openDialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
        openPopovers: [...document.querySelectorAll(':popover-open')].map((popover) => popover.className),
        animations: document.getAnimations().map((animation) => ({
          target: animation.effect instanceof KeyframeEffect ? animation.effect.target?.className : undefined,
          state: animation.playState,
          time: animation.currentTime
        }))
      }))
      .then(async (state) => ({
        ...state,
        // Where the open dialog and its buttons sit over a few frames, and whether frames come at all, since a click
        // waits for its target to stand still for two frames.
        frames: await page.evaluate(async () => {
          const samples: Array<unknown> = []
          for (let frame = 0; frame < 5; frame++) {
            const drawn = await Promise.race([
              new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true))),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
            ])
            const dialog = document.querySelector('dialog[open]')
            const rect = (element: Element | null | undefined) => {
              const box = element?.getBoundingClientRect()
              return box && [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100).join(',')
            }
            samples.push({
              drawn,
              dialog: rect(dialog),
              dialogScroll: dialog?.scrollTop,
              submit: rect(dialog?.querySelector('[type="submit"]')),
              body: dialog?.querySelector('.dialog-sheet-body')?.scrollTop,
              page: document.scrollingElement?.scrollTop
            })
          }
          return samples
        })
      }))
      .catch((error: unknown) => String(error))
    await writeFile(testInfo.outputPath('diagnostics.txt'), [...log, JSON.stringify(state, null, 2)].join('\n'))
  }
})
