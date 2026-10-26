interface Toast {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: 'short' | 'long'
}

const queue: Array<Required<Toast>> = []
let showing = false

// Shows a toast until its time is up or it is tapped. It slides out the way it came in, and resolves once it has gone.
const showOne = ({ message, type, duration }: Required<Toast>) =>
  new Promise<void>((resolve) => {
    const popup = document.createElement('div')
    popup.classList.add('toast-message-popup', type)
    popup.textContent = message
    // A toast stays up through the next page, as after "Workout session deleted".
    popup.dataset.persist = ''
    document.body.appendChild(popup)

    const dismiss = async () => {
      popup.classList.add('leaving')
      // Reading a style applies the class now, so the transitions it starts are there to wait for.
      void getComputedStyle(popup).opacity
      await Promise.allSettled(popup.getAnimations().map(({ finished }) => finished))
      popup.remove()
      resolve()
    }

    const timeout = setTimeout(() => void dismiss(), duration === 'short' ? 3000 : 5000)
    popup.addEventListener(
      'click',
      () => {
        clearTimeout(timeout)
        void dismiss()
      },
      { once: true }
    )
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
  show({ message, type = 'success', duration = 'short' }: Toast) {
    queue.push({ message, type, duration })
    void showQueued()
  }
}

export default Toasts
