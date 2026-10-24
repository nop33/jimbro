import BreakTimerDialog from './pages/gymtime/BreakTimerDialog'
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

// Puts the next page's body in place of this one's, except what outlives a page (data-persist), such as the break
// timer, a toast or confetti, which stay where they are so they keep running. The next page's copy of them goes.
const replaceBody = (next: Document) => {
  document.title = next.title
  const kept = document.body.querySelectorAll(':scope > [data-persist]')
  for (const element of kept) if (element.id) next.getElementById(element.id)?.remove()
  for (const child of document.body.querySelectorAll(':scope > *')) {
    if (!(child instanceof Element && child.hasAttribute('data-persist'))) child.remove()
  }
  document.body.className = next.body.className
  document.body.prepend(...document.adoptNode(next.body).childNodes)
}

// A failed fetch or import, as when a new build replaced the files this document knows, loads the page in full.
let loadingInFull = false
const loadInFull = (url: URL) => {
  loadingInFull = true
  window.location.assign(url)
}

// Loads one of the app's own pages as a document, which the browser parses without running its scripts. The service
// worker answers from its cache, so this costs no network.
const loadPage = (url: URL) =>
  new Promise<Document>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url.pathname)
    request.responseType = 'document'
    request.addEventListener('load', () =>
      request.status === 200 && request.responseXML
        ? resolve(request.responseXML)
        : reject(new Error(`${url.pathname} answered ${request.status}`))
    )
    request.addEventListener('error', () => reject(new Error(`${url.pathname} failed to load`)))
    request.send()
  })

// Shows the page at url in this document. The old page stays on screen, frozen by the view transition, until the new
// one has drawn its data, so a tap never shows an empty page, and the header and nav stay still across it.
const show = async (url: URL, page: () => Promise<Page>, event: NavigateEvent) => {
  let next: Document
  let module: Page
  try {
    ;[next, module] = await Promise.all([loadPage(url), page()])
  } catch (error) {
    console.error('Failed to show the next page:', error)
    loadInFull(url)
    return
  }
  if (event.signal.aborted) return

  const update = async () => {
    replaceBody(next)
    await mount(module)
    event.scroll()
  }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  await document.startViewTransition(update).updateCallbackDone
}

// Each tap on a link, Back and Forward, and each location change from script stay in this document when they go to
// one of the app's pages. A reload, a download or a form post stays a browser navigation, and a history.replaceState
// on the same page, such as gymtime's ?id= once a workout starts, only changes the address. Browsers without the
// Navigation API load each page in full, and every page still works that way.
window.navigation?.addEventListener('navigate', (event) => {
  const url = new URL(event.destination.url)
  const page = PAGES[pagePath(url)]
  if (
    loadingInFull ||
    !page ||
    !event.canIntercept ||
    event.hashChange ||
    event.downloadRequest !== null ||
    event.formData ||
    event.navigationType === 'reload' ||
    (event.navigationType === 'replace' && pagePath(url) === pagePath(new URL(window.location.href))) ||
    url.origin !== window.location.origin
  )
    return
  event.intercept({ scroll: 'manual', handler: () => show(url, page, event) })
})

// The break timer outlives every page, so it is wired once for the document.
BreakTimerDialog.init()

const first = PAGES[pagePath(new URL(window.location.href))]
if (first) void first().then(mount)
