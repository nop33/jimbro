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

const dropOldCaches = async () => {
  const keys = await caches.keys()
  await Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))
  )
}

// '/gymtime', '/gymtime/index.html' and '/gymtime/?id=1' all open the page cached as '/gymtime/'.
const pagePath = (url: URL) => {
  const path = url.pathname.replace(/index\.html$/, '')
  return path.endsWith('/') ? path : `${path}/`
}

const respond = async (request: Request) => {
  const url = new URL(request.url)
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request.mode === 'navigate' ? pagePath(url) : url.pathname)
  return cached ?? fetch(request)
}

self.addEventListener('install', (event) => {
  // A new build takes over at once. Pages are full loads, so an open page keeps the files it already loaded.
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
