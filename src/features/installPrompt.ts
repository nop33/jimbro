// Chrome offers the install once per document, often before the home page with the install button shows, so the
// offer is kept here from the start, for the button to use whenever it shows.
let deferredPrompt: Event | null = null

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event
})

// Shows the browser's install prompt, or returns false where the browser offers none, as Safari never does.
export const promptInstall = () => {
  if (deferredPrompt && 'prompt' in deferredPrompt && typeof deferredPrompt.prompt === 'function') {
    deferredPrompt.prompt()
    return true
  }
  return false
}

// Calls installed once the app is installed, until signal aborts.
export const onAppInstalled = (installed: () => void, signal: AbortSignal) => {
  window.addEventListener('appinstalled', installed, { signal })
}
