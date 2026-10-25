import { markRendered } from './sync/freshness'

// A page's module draws the page into the document and wires it, until signal aborts as the next page replaces it.
interface Page {
  mount: (signal: AbortSignal) => void | Promise<void>
}

const PAGES: Record<string, () => Promise<Page>> = {
  '/': () => import('./pages/home/index'),
  '/exercises/': () => import('./pages/exercises/index'),
  '/programs/': () => import('./pages/programs/index'),
  '/workouts/': () => import('./pages/workouts/index'),
  '/gymtime/': () => import('./pages/gymtime/index'),
  '/stats/': () => import('./pages/stats/index'),
  '/settings/': () => import('./pages/settings/index')
}

// '/gymtime', '/gymtime/index.html' and '/gymtime/?id=1' are all the gymtime page.
const pagePath = (url: URL) => {
  const path = url.pathname.replace(/index\.html$/, '')
  return path.endsWith('/') ? path : `${path}/`
}

// The page on screen, which aborts when the next one replaces it.
let shown: AbortController | undefined

const mount = async (page: Page) => {
  shown?.abort()
  shown = new AbortController()
  try {
    await page.mount(shown.signal)
  } finally {
    markRendered()
  }
}

const first = PAGES[pagePath(new URL(window.location.href))]
if (first) void first().then(mount)
