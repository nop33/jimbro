/**
 * Smooth expand/collapse for a <details> element.
 *
 * Intercepts summary clicks, disables the native snap-open/snap-close, and
 * animates the height and opacity of the content wrapper via Web Animations
 * API. Respects prefers-reduced-motion.
 *
 * The <details> element must have exactly one direct content wrapper after
 * its summary — pass that wrapper as the second argument.
 *
 * When `accordionSelector` is provided, opening this details will animate
 * closed any other currently-open details matching the selector.
 */

const DURATION_MS = 220
// The --ease-out curve in src/style.css. The Web Animations API can't read a CSS variable.
const EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'

// Registry keyed by <details> so opening one card can animate-close others.
// WeakMap lets entries be GC'd automatically when a card is replaced.
const closers = new WeakMap<HTMLDetailsElement, () => void>()

export interface AnimateDetailsHandle {
  /** Animate the <details> closed. No-op if already closed or closing. */
  close: () => void
  /**
   * Runs `callback` once no close is running: right away, or when the running
   * close ends or turns back into an open. A change that would shorten the
   * content waits here, so a close always starts from the full height.
   */
  afterClose: (callback: () => void) => void
}

export function animateDetails(
  details: HTMLDetailsElement,
  content: HTMLElement,
  options: { accordionSelector?: string } = {}
): AnimateDetailsHandle {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let currentAnimation: Animation | null = null
  let isClosing = false
  let waitingForClose: Array<() => void> = []

  const endClose = () => {
    isClosing = false
    const callbacks = waitingForClose
    waitingForClose = []
    callbacks.forEach((callback) => callback())
  }

  const afterClose = (callback: () => void) => {
    if (isClosing) waitingForClose.push(callback)
    else callback()
  }

  // An open summary has a gap under it (style.css), which the open attribute alone would add and drop in one frame,
  // a jump at the end of every close. So the summary's margin moves with the content's height.
  const summary = details.querySelector('summary')

  // How far the details is open: the content's height and the summary's gap, as they show now.
  const measure = () => ({
    height: content.getBoundingClientRect().height,
    gap: summary ? parseFloat(getComputedStyle(summary).marginBottom) : 0
  })
  const shut = { height: 0, gap: 0 }

  const stop = () => {
    currentAnimation = null
    for (const element of [content, summary]) element?.getAnimations().forEach((animation) => animation.cancel())
    // Remove the forwards fill and the seeded inline styles so each element returns to its stylesheet values (or
    // stays unrendered when closed).
    content.style.overflowY = ''
    content.style.height = ''
    content.style.opacity = ''
    if (summary) summary.style.marginBottom = ''
  }

  // The open details' full height and gap, read with nothing animating them.
  const fullyOpen = () => {
    stop()
    return { height: content.scrollHeight, gap: measure().gap }
  }

  const runAnimation = (
    from: { height: number; gap: number },
    to: { height: number; gap: number },
    onFinish?: () => void
  ) => {
    stop()
    // Seed the inline styles to match the starting keyframe so the first paint after setAttribute('open') never shows
    // the element at its natural height.
    // Clips only the height, so what sits on the content's side edges, like the Max pill, stays whole.
    content.style.overflowY = 'clip'
    content.style.height = `${from.height}px`
    content.style.opacity = from.height === 0 ? '0' : '1'
    if (summary) summary.style.marginBottom = `${from.gap}px`
    const timing = { duration: DURATION_MS, easing: EASING, fill: 'forwards' } as const
    const animation = content.animate(
      [
        { height: `${from.height}px`, opacity: from.height === 0 ? 0 : 1 },
        { height: `${to.height}px`, opacity: to.height === 0 ? 0 : 1 }
      ],
      timing
    )
    summary?.animate([{ marginBottom: `${from.gap}px` }, { marginBottom: `${to.gap}px` }], timing)
    currentAnimation = animation
    animation.onfinish = () => {
      if (currentAnimation !== animation) return
      stop()
      onFinish?.()
    }
  }

  const open = () => {
    if (details.open && !isClosing) return

    if (isClosing) {
      // Reverse an in-flight close. The <details> is still [open] at this
      // point — we only remove the attribute at the end of a close animation.
      const current = measure()
      endClose()
      const target = fullyOpen()
      if (reducedMotion) return
      runAnimation(current, target)
      return
    }

    details.setAttribute('open', '')
    if (reducedMotion) return
    // The content is measurable now that it is in layout.
    runAnimation(shut, fullyOpen())
  }

  const close = () => {
    if (!details.open || isClosing) return

    if (reducedMotion) {
      details.removeAttribute('open')
      return
    }

    isClosing = true
    runAnimation(measure(), shut, () => {
      details.removeAttribute('open')
      endClose()
    })
  }

  if (!summary) return { close, afterClose }

  summary.addEventListener('click', (e) => {
    e.preventDefault()
    if (details.open && !isClosing) {
      close()
    } else {
      if (options.accordionSelector) {
        document.querySelectorAll<HTMLDetailsElement>(`${options.accordionSelector}[open]`).forEach((other) => {
          if (other !== details) closers.get(other)?.()
        })
      }
      open()
    }
  })

  closers.set(details, close)

  return { close, afterClose }
}
