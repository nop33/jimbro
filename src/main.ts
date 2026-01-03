import './style.css'

const installBtn = document.getElementById('install-btn') as HTMLButtonElement
let deferredPrompt: Event | null = null

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
})

installBtn.addEventListener('click', () => {
  if (deferredPrompt && 'prompt' in deferredPrompt && typeof deferredPrompt.prompt === 'function') {
    deferredPrompt.prompt()
  } else {
    alert("To install the app on iOS tap the Share icon in Safari, then select 'Add to Home Screen'.")
  }
})

window.addEventListener('appinstalled', () => installBtn.remove())
