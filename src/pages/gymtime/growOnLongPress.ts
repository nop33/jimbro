// Holding Finished set grows it to half the screen, so after a hard set a shaky hand can't miss it. The hold only grows
// it: its release logs nothing, and the next tap anywhere on the grown button logs the set. The button shrinks back
// when that tap logs the set, on a tap anywhere else, on Escape, or when its card closes.

// About as long as the browser's own long press, which this replaces: CSS turns off the callout and text selection.
const HOLD_MS = 450
// A finger that moves further than this is scrolling, not holding.
const MOVE_TOLERANCE_PX = 10

export interface GrowHandle {
  readonly grown: boolean
  collapse(): void
}

export const growOnLongPress = (button: HTMLButtonElement): GrowHandle => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start = { x: 0, y: 0 }
  // The click that ends the hold which grew the button, which must not log a set.
  let swallowClick = false
  // Stops the listeners that only a grown button needs.
  let whileGrown: AbortController | undefined

  const cancelHold = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const collapse = () => {
    cancelHold()
    if (!whileGrown) return
    whileGrown.abort()
    whileGrown = undefined
    button.classList.remove('isGrown')
  }

  const grow = () => {
    timer = undefined
    swallowClick = true
    button.classList.add('isGrown')
    navigator.vibrate?.(15)

    whileGrown = new AbortController()
    const { signal } = whileGrown
    // Once it has grown, the button sits in the middle of the screen. Under reduced motion it grows at once, and the
    // transition that ends at once still ends.
    button.addEventListener(
      'transitionend',
      (event) => {
        if (event.propertyName === 'min-height') button.scrollIntoView({ block: 'center' })
      },
      { signal }
    )
    // Capture sees a tap before whatever it lands on handles it. The tap still does what it does.
    document.addEventListener(
      'click',
      (event) => {
        if (!button.contains(event.target as Node)) collapse()
      },
      { capture: true, signal }
    )
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') collapse()
      },
      { signal }
    )
  }

  button.addEventListener('pointerdown', (event) => {
    swallowClick = false
    if (!event.isPrimary || event.button !== 0 || whileGrown) return
    start = { x: event.clientX, y: event.clientY }
    cancelHold()
    timer = setTimeout(grow, HOLD_MS)
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

  return {
    get grown() {
      return whileGrown !== undefined
    },
    collapse
  }
}
