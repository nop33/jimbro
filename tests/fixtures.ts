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
  }
})
