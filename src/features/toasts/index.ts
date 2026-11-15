interface Toast {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: 'short' | 'long'
  // A prominent toast stands out, with a check badge and the message as a bold title, as when a workout starts.
  prominent?: boolean
}

type Queued = Required<Toast>

// Fills a prominent toast: the badge, then the title.
const fillProminent = (popup: HTMLElement, message: string) => {
  popup.classList.add('prominent')
  const badge = document.createElement('span')
  badge.className = 'toast-badge'
  badge.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  const title = document.createElement('p')
  title.className = 'toast-title'
  title.textContent = message
  popup.append(badge, title)
}

const queue: Queued[] = []
let showing = false

// Shows a toast until its time is up. It slides out the way it came in, and resolves once it has gone. Taps pass through
// it to the page (style.css), so it has no tap to dismiss.
const showOne = ({ message, type, duration, prominent }: Queued) =>
  new Promise<void>((resolve) => {
    const popup = document.createElement('div')
    popup.classList.add('toast-message-popup', type)
    if (prominent) fillProminent(popup, message)
    else popup.textContent = message
    // A toast stays up through the next page, as after "Workout session deleted".
    popup.dataset.persist = ''
    // A manual popover shows in the top layer, so a modal dialog open when it shows, such as the break timer that the
    // workout's first set opens, does not hide it.
    popup.popover = 'manual'
    document.body.appendChild(popup)
    popup.showPopover()

    const dismiss = async () => {
      popup.classList.add('leaving')
      // Reading a style applies the class now, so the transitions it starts are there to wait for.
      void getComputedStyle(popup).opacity
      await Promise.allSettled(popup.getAnimations().map(({ finished }) => finished))
      popup.remove()
      resolve()
    }

    setTimeout(() => void dismiss(), duration === 'short' ? 3000 : 5000)
  })

// Shows the queued toasts one after another, the next once the last has gone.
const showQueued = async () => {
  if (showing) return
  showing = true
  for (let next = queue.shift(); next; next = queue.shift()) await showOne(next)
  showing = false
}

const Toasts = {
  // Nothing waits for a toast.
  show({ message, type = 'success', duration = 'short', prominent = false }: Toast) {
    queue.push({ message, type, duration, prominent })
    void showQueued()
  }
}

export default Toasts
