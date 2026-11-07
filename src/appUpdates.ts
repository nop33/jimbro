import { busy } from './redraw'

// How often an app left open checks for a new build. A check fetches only sw.js, which Netlify never lets the browser
// keep without asking, so it costs one small request.
const CHECK_EVERY_MS = 30 * 60 * 1000
// A new build that takes over this soon after the app came into view replaces the page at once: the check that found
// it ran as the app opened, so the lifter has barely looked at the old page.
const FRESH_VIEW_MS = 10 * 1000

// Registers the service worker, which caches every page and asset so the app opens offline, and moves the app to each
// new build soon after it deploys.
//
// The browser looks for a new sw.js only when a page loads in full. The router keeps every tap in one document, and a
// phone mostly brings an installed app back from the background instead of opening it again, so that can take days.
// So the app asks for sw.js itself each time it comes into view and every half hour while it stays in view. A new
// build caches its files and takes over (src/serviceWorker.ts), and from then on the router loads the next tap in full
// from it. The page on screen moves to it sooner, with a reload, whenever nothing would be lost: no dialog open, the
// break timer's included, and no field being typed in. It reloads when the new build takes over within moments of the
// app coming into view, or else the next time the app goes out of view or comes back.
//
// The router asks buildChanged() before each tap, so the whole app follows this one rule for when the build on screen is
// no longer the one the service worker serves.
let newBuild = false

// Whether a new build's service worker took over since this document loaded, so its pages and this document's scripts
// come from two builds.
export const buildChanged = () => newBuild

export const followNewBuilds = async () => {
  let lastCheck = Date.now()
  let inViewSince = document.visibilityState === 'visible' ? Date.now() : 0
  const reloadIfSafe = () => {
    if (newBuild && !busy()) window.location.reload()
  }

  // The first service worker takes over a page it didn't serve, from the same build, so only a later takeover brings a
  // new build. The listener goes on before the registration, so it hears every takeover.
  let controlled = navigator.serviceWorker.controller !== null
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    newBuild = true
    if (document.visibilityState === 'visible' && Date.now() - inViewSince < FRESH_VIEW_MS) reloadIfSafe()
  })

  const registration = await navigator.serviceWorker.register('/sw.js')
  const check = () => {
    // Offline, or when sw.js fails to load, the old build stays, and the next check tries again.
    registration.update().catch(() => undefined)
  }

  document.addEventListener('visibilitychange', () => {
    reloadIfSafe()
    if (document.visibilityState !== 'visible') return
    inViewSince = Date.now()
    lastCheck = Date.now()
    check()
  })
  window.setInterval(() => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_EVERY_MS) return
    lastCheck = Date.now()
    check()
  }, 60 * 1000)
}
