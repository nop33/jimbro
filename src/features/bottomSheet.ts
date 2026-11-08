// A sheet (a `dialog.dialog-sheet`) behaves as the phone's own sheets do: it follows a finger that pulls it down, and
// closes once pulled far or flicked, or slides back up when let go before then. A tap on the backdrop above it closes
// it too. It closes through its own ✕, so whatever that button does on closing happens here as well.
//
// A pull starts only where the content under the finger is scrolled to its top and the finger moves more down than
// sideways, so the body still scrolls, a chip row still scrolls sideways, and pulling a scrolled list scrolls it back up
// first. Touch events, not pointer events: once the browser starts a scroll it takes the pointer away, and only a
// touchmove's preventDefault keeps the first move from starting one, in Safari too. A mouse has the ✕ and Esc.
export function pullDownToClose(dialog: HTMLDialogElement) {
  // A move this small is still a tap, and tells neither way.
  const slop = 4
  let pull: {
    id: number
    startX: number
    startY: number
    pulling: boolean | null
    distance: number
    y: number
    time: number
    speed: number
  } | null = null

  const closeSheet = () => {
    const closeButton = dialog.querySelector<HTMLButtonElement>('.close-dialog-btn')
    if (closeButton) closeButton.click()
    else dialog.close()
  }

  dialog.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      pull = touch
        ? {
            id: touch.identifier,
            startX: touch.clientX,
            startY: touch.clientY,
            pulling: null,
            distance: 0,
            y: touch.clientY,
            time: event.timeStamp,
            speed: 0
          }
        : null
    },
    { passive: true }
  )

  dialog.addEventListener(
    'touchmove',
    (event) => {
      const touch = pull && [...event.changedTouches].find(({ identifier }) => identifier === pull?.id)
      if (!pull || !touch || pull.pulling === false) return
      const dx = touch.clientX - pull.startX
      const dy = touch.clientY - pull.startY
      if (pull.pulling === null) {
        if (Math.abs(dx) < slop && Math.abs(dy) < slop) return
        pull.pulling = dy > 0 && dy >= Math.abs(dx) && scrolledToTop(event.target, dialog)
        if (!pull.pulling) return
        dialog.style.transition = 'none'
      }
      event.preventDefault()
      // Pixels per millisecond over the last move, to tell a flick from a slow pull.
      pull.speed = (touch.clientY - pull.y) / Math.max(event.timeStamp - pull.time, 1)
      pull.y = touch.clientY
      pull.time = event.timeStamp
      pull.distance = Math.max(dy, 0)
      dialog.style.translate = `0 ${pull.distance}px`
    },
    { passive: false }
  )

  const release = (event: TouchEvent) => {
    if (!pull || ![...event.changedTouches].some(({ identifier }) => identifier === pull?.id)) return
    const { pulling, distance, speed } = pull
    pull = null
    if (!pulling) return
    dialog.style.transition = ''
    const far = distance > Math.min(120, dialog.offsetHeight / 3) || (distance > 40 && speed > 0.5)
    if (event.type === 'touchend' && far) slideAway(dialog, distance, closeSheet)
    else dialog.style.translate = ''
  }
  dialog.addEventListener('touchend', release)
  dialog.addEventListener('touchcancel', release)

  // A tap on the backdrop lands on the dialog itself, outside its box.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    if (!inside) closeSheet()
  })

  dialog.addEventListener('close', () => {
    dialog.style.translate = ''
    dialog.style.transition = ''
  })
}

// Whether every box that scrolls between the touched element and the sheet is at its top, so a pull down would only
// bounce it.
function scrolledToTop(target: EventTarget | null, dialog: HTMLDialogElement) {
  for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element)
    const scrolls = (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight
    if (scrolls && element.scrollTop > 0) return false
    if (element === dialog) break
  }
  return true
}

// The sheet carries on down from where the finger left it, then closes. Without motion it closes at once.
function slideAway(dialog: HTMLDialogElement, from: number, close: () => void) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    close()
    return
  }
  const slide = dialog.animate([{ translate: `0 ${from}px` }, { translate: '0 100%' }], {
    duration: 200,
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    fill: 'forwards'
  })
  slide.finished.then(
    () => {
      close()
      dialog.style.translate = ''
      slide.cancel()
    },
    () => close()
  )
}
