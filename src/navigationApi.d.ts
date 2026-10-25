// The Navigation API, which the router in router.ts runs on (Chromium 102, Safari 26.2). TypeScript's DOM types don't
// declare it yet, so this declares the parts the router uses. Browsers without it leave window.navigation undefined.
interface NavigationDestination {
  readonly url: string
}

interface NavigationInterceptOptions {
  handler?: () => Promise<void>
  focusReset?: 'after-transition' | 'manual'
  scroll?: 'after-transition' | 'manual'
}

interface NavigateEvent extends Event {
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse'
  readonly destination: NavigationDestination
  readonly canIntercept: boolean
  readonly hashChange: boolean
  readonly downloadRequest: string | null
  readonly formData: FormData | null
  readonly signal: AbortSignal
  intercept(options?: NavigationInterceptOptions): void
  scroll(): void
}

interface Navigation extends EventTarget {
  addEventListener(type: 'navigate', listener: (event: NavigateEvent) => void): void
}

interface Window {
  readonly navigation?: Navigation
}
