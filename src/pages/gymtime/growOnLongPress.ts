// Holding Finished set grows it to half the screen, so after a hard set a shaky hand can't miss it. It stays grown
// set after set, on every card of the workout, and only another hold on it shrinks it back. A hold only grows or
// shrinks it: its release logs nothing, and a tap logs the set either way. The class goes on the exercises list, so a
// card opened next shows its button grown too.

// About as long as the browser's own long press, which this replaces: CSS turns off the callout and text selection.
const HOLD_MS = 450
// A finger that moves further than this is scrolling, not holding.
const MOVE_TOLERANCE_PX = 10

export const growOnLongPress = (button: HTMLButtonElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start = { x: 0, y: 0 }
  // The click that ends a hold, which must not log a set.
  let swallowClick = false

  const cancelHold = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const toggle = () => {
    timer = undefined
    swallowClick = true
    const grown = (button.closest('#exercises-list') ?? button).classList.toggle('finish-set-grown')
    navigator.vibrate?.(15)
    if (!grown) return
    // Once it has grown, the button sits in the middle of the screen. Under reduced motion it grows at once, and the
    // transition that ends at once still ends.
    button.addEventListener('transitionend', function centre(event) {
      if (event.propertyName !== 'min-height') return
      button.removeEventListener('transitionend', centre)
      button.scrollIntoView({ block: 'center' })
    })
  }

  button.addEventListener('pointerdown', (event) => {
    swallowClick = false
    if (!event.isPrimary || event.button !== 0) return
    start = { x: event.clientX, y: event.clientY }
    cancelHold()
    timer = setTimeout(toggle, HOLD_MS)
  })
  button.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancelHold()
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    button.addEventListener(type, cancelHold)
  }
  // Android opens a context menu on a long touch. The hold is this button's own long press.
  button.addEventListener('contextmenu', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    if (!swallowClick) return
    swallowClick = false
    event.preventDefault()
  })
}
