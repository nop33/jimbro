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
      .catch((error: unknown) => String(error))
    await writeFile(testInfo.outputPath('diagnostics.txt'), [...log, JSON.stringify(state, null, 2)].join('\n'))
  }
})
