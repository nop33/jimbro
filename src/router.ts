import { breakTimer } from './features/breakTimer'
import './features/installPrompt'
import { keepPagesFresh } from './redraw'
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

// Mounts the page into the body in place, and resolves to false when its mount threw, which leaves the body drawn
// but not wired, so the caller loads the page in full instead.
const mount = async (page: Page) => {
  shown?.abort()
  shown = new AbortController()
  try {
    await page.mount(shown.signal)
    return true
  } catch (error) {
    console.error('The page failed to mount:', error)
    return false
  } finally {
    markRendered()
  }
}

// Puts the next page's body in place of this one's, except what outlives a page (data-persist): the break timer, a
// toast or confetti, which stay where they are so they keep running. The next page's own copy of them goes.
const replaceBody = (next: Document) => {
  document.title = next.title
  for (const kept of document.body.querySelectorAll(':scope > [data-persist]')) {
    if (kept.id) next.getElementById(kept.id)?.remove()
  }
  for (const child of document.body.querySelectorAll(':scope > :not([data-persist])')) child.remove()
  document.body.className = next.body.className
  document.body.prepend(...document.adoptNode(next.body).childNodes)
}

// Loads one of the app's pages as a document, which the browser parses without running its scripts. The service
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

// Once the document can't show a page itself, every navigation loads in full: after a failed load, and after a new
// build's service worker took over, so the whole app moves to the new build together instead of mixing the two.
let inFull = false
const loadInFull = (url: URL) => {
  inFull = true
  window.location.assign(url)
}
// The first service worker takes over a page it didn't serve, from the same build, so only a later one is a new build.
if (navigator.serviceWorker?.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    inFull = true
  })
}

// Shows the page at url in this document. The old page stays on screen, frozen by the view transition, until the new
// one has drawn its data, so a tap never shows an empty page, and the header and nav stay still across it.
const show = async (url: URL, page: () => Promise<Page>, event: NavigateEvent) => {
  let next: Document
  let module: Page
  try {
    ;[next, module] = await Promise.all([loadPage(url), page()])
  } catch (error) {
    console.error('Could not show the next page, so it loads in full:', error)
    loadInFull(url)
    return
  }
  if (event.signal.aborted) return

  const update = async () => {
    replaceBody(next)
    if (!(await mount(module))) {
      loadInFull(url)
      return
    }
    // Back and Forward bring the page back where it was. A new page starts at its top. The router scrolls there itself,
    // since event.scroll() in CI's Chromium left a page shorter than the last one scrolled to its bottom.
    if (event.navigationType === 'traverse') event.scroll()
    else window.scrollTo(0, 0)
  }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  await document.startViewTransition(update).updateCallbackDone
}

// Each tap on a link, Back and Forward, and each location change from script stay in this document when they go to one
// of the app's pages. A reload, a download or a form post stays a browser navigation, and so does history.replaceState
// on the same page, such as gymtime's ?id= once a workout starts, which only changes the address. Browsers without the
// Navigation API load each page in full, and every page works that way too. Focus moves to the new page once it shows,
// the Navigation API's default, so a screen reader starts reading it.
window.navigation?.addEventListener('navigate', (event) => {
  const url = new URL(event.destination.url)
  const page = PAGES[pagePath(url)]
  const here = new URL(window.location.href)
  if (
    inFull ||
    !page ||
    !event.canIntercept ||
    event.hashChange ||
    event.downloadRequest !== null ||
    event.formData !== null ||
    event.navigationType === 'reload' ||
    (event.navigationType === 'replace' && pagePath(url) === pagePath(here)) ||
    url.origin !== here.origin
  )
    return
  event.intercept({ scroll: 'manual', handler: () => show(url, page, event) })
})

// Draws the page on screen again from fresh markup and the database, where it is, without a view transition. The
// scroll position and the sections the user opened stay as they were, so a redraw changes only what the data changed.
// It needs no Navigation API, so WebKit without it redraws in place too. A failed load or mount loads the page in full.
const redrawInPlace = async () => {
  const url = new URL(window.location.href)
  const page = PAGES[pagePath(url)]
  if (inFull || !page) {
    window.location.reload()
    return
  }
  let next: Document
  let module: Page
  try {
    ;[next, module] = await Promise.all([loadPage(url), page()])
  } catch (error) {
    console.error('Could not redraw the page, so it loads in full:', error)
    window.location.reload()
    return
  }
  const scrolled = window.scrollY
  const opened = [...document.querySelectorAll<HTMLDetailsElement>('details[open][id]')].map((details) => details.id)
  replaceBody(next)
  for (const id of opened) {
    const details = document.getElementById(id)
    if (details instanceof HTMLDetailsElement) details.open = true
  }
  if (!(await mount(module))) {
    window.location.reload()
    return
  }
  window.scrollTo(0, scrolled)
}

// The break timer outlives every page, so the document wires it once.
breakTimer()
keepPagesFresh(redrawInPlace)

const first = PAGES[pagePath(new URL(window.location.href))]
if (first) void first().then(mount)
