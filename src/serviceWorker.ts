// Built to /sw.js by the serviceWorker plugin in vite.config.ts, which replaces these two names with the build's
// files and a hash of their contents. Every page and asset is cached on install, so the app opens offline.
declare const self: ServiceWorkerGlobalScope
declare const __PRECACHE_URLS__: string[]
declare const __PRECACHE_VERSION__: string

const CACHE_PREFIX = 'jimbro-'
const CACHE = `${CACHE_PREFIX}${__PRECACHE_VERSION__}`

const precache = async () => {
  const cache = await caches.open(CACHE)
  await Promise.all(
    __PRECACHE_URLS__.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' })
      if (!response.ok) throw new Error(`Precaching ${url} failed with ${response.status}`)
      // A navigation can't be answered with a response that followed a redirect, so store a fresh copy.
      await cache.put(url, response.redirected ? new Response(await response.blob(), response) : response)
    })
  )
}

// A page that opened before this build took over still loads its own build's files later, such as Chart.js when the
// history chart first opens. So the build before this one stays cached until the next one takes over, and only older
// builds go.
const dropOldCaches = async () => {
  const builds = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
  // Caches list in the order they were made, so the last one left is the build this one replaces.
  await Promise.all(builds.slice(0, -1).map((key) => caches.delete(key)))
}

// '/gymtime', '/gymtime/index.html' and '/gymtime/?id=1' all open the page cached as '/gymtime/'.
const pagePath = (url: URL) => {
  const path = url.pathname.replace(/index\.html$/, '')
  return path.endsWith('/') ? path : `${path}/`
}

const respond = async (request: Request) => {
  const url = new URL(request.url)
  const cache = await caches.open(CACHE)
  if (request.mode === 'navigate') return (await cache.match(pagePath(url))) ?? fetch(request)
  // A file this build doesn't have may be the previous build's, asked for by a page that opened before this one.
  return (await cache.match(url.pathname)) ?? (await caches.match(url.pathname)) ?? fetch(request)
}

self.addEventListener('install', (event) => {
  // A new build takes over at once. An open page keeps the files it already loaded, and its router loads the next
  // page in full, from the new build.
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldCaches().then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // The sync requests go to the worker's origin, so they always reach the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(respond(request))
})

// A break alert from the worker (src/sync/breakAlerts.ts): it shows even while Jimbro is in the background, which is
// the only time the app asks for one.
self.addEventListener('push', (event) => {
  const alert = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string }
  event.waitUntil(
    self.registration.showNotification(alert.title ?? 'Break over', {
      body: alert.body ?? '',
      icon: '/icons/logo-192.png',
      tag: 'break-alert',
      data: { url: alert.url ?? '/gymtime/' }
    })
  )
})

// A tap on the alert brings Jimbro back, or opens the workout when it was closed.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | null)?.url ?? '/gymtime/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow(url)
    })
  )
})
