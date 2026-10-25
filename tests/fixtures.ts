import { test as base } from '@playwright/test'

export interface RouterOptions {
  // Whether the page gets the browser's Navigation API, which the router shows each page in the same document with.
  navigationApi: boolean
}

// TEMP diagnostics for the WebKit lost-tap flake.
const logEvents = () => {
  const log: string[] = []
  Object.defineProperty(globalThis, '__tapLog', { value: log })
  const t0 = performance.now()
  const describe = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return String(target)
    return `${target.tagName.toLowerCase()}.${[...target.classList].slice(0, 2).join('.')}"${(target.textContent ?? '').trim().slice(0, 14)}"`
  }
  const state = () => {
    const open = [...document.querySelectorAll<HTMLDetailsElement>('details.exercise-details[open]')]
    return open
      .map((details) => {
        const content = details.querySelector<HTMLElement>('.exercise-details-content')
        return `open(h=${content?.getBoundingClientRect().height.toFixed(1)},anims=${content?.getAnimations().length})`
      })
      .join(' ')
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'submit', 'touchstart', 'touchend']) {
    window.addEventListener(
      type,
      (event) => {
        const e = event as MouseEvent
        const at = 'clientX' in e ? ` at=${e.clientX},${e.clientY} hit=${describe(document.elementFromPoint(e.clientX, e.clientY))}` : ''
        log.push(`${(performance.now() - t0).toFixed(0)} ${type} ${describe(event.target)}${at} scrollY=${window.scrollY} ${state()}`)
      },
      { capture: true }
    )
  }
  window.addEventListener('error', (e) => log.push(`ERROR ${e.message}`))
  window.addEventListener('unhandledrejection', (e) => log.push(`REJECTION ${String(e.reason)}`))
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
    await context.addInitScript(logEvents)
    await use(context)
  },
  page: async ({ page }, use, testInfo) => {
    const messages: string[] = []
    page.on('console', (message) => messages.push(`console.${message.type()} ${message.text()}`))
    page.on('pageerror', (error) => messages.push(`pageerror ${error.message}`))
    await use(page)
    if (testInfo.status !== testInfo.expectedStatus) {
      const log = await page
        .evaluate(() => (globalThis as unknown as { __tapLog?: string[] }).__tapLog ?? [])
        .catch(() => ['(page gone)'])
      console.log(`TAPLOG ${testInfo.project.name} ${testInfo.title}\n${[...messages, ...log].join('\n')}\nEND TAPLOG`)
    }
  }
})
