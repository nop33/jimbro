interface Toast {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: 'short' | 'long'
  // A second line makes it a prominent toast: a check badge, the message as a title, and the line under it with a
  // watch icon, as when a workout starts.
  detail?: string
}

type Queued = Required<Omit<Toast, 'detail'>> & Pick<Toast, 'detail'>

const icon = (kind: 'check' | 'watch') => {
  const span = document.createElement('span')
  span.className = kind === 'check' ? 'toast-badge' : 'toast-detail-icon'
  span.innerHTML =
    kind === 'check'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"/><polyline points="12 10 12 12 13 13"/><path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/><path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/></svg>'
  return span
}

// Fills a prominent toast: the badge, then the title and the detail line under it.
const fillProminent = (popup: HTMLElement, message: string, detail: string) => {
  popup.classList.add('prominent')
  const title = document.createElement('p')
  title.className = 'toast-title'
  title.textContent = message
  const line = document.createElement('p')
  line.className = 'toast-detail'
  line.append(icon('watch'), detail)
  const text = document.createElement('div')
  text.append(title, line)
  popup.append(icon('check'), text)
}

const queue: Queued[] = []
let showing = false

// Shows a toast until its time is up. It slides out the way it came in, and resolves once it has gone. Taps pass through
// it to the page (style.css), so it has no tap to dismiss.
const showOne = ({ message, type, duration, detail }: Queued) =>
  new Promise<void>((resolve) => {
    const popup = document.createElement('div')
    popup.classList.add('toast-message-popup', type)
    if (detail) fillProminent(popup, message, detail)
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
  show({ message, type = 'success', duration = 'short', detail }: Toast) {
    queue.push({ message, type, duration, detail })
    void showQueued()
  }
}

export default Toasts
