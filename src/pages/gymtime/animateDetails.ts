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
const EASING = 'ease-out'

// Registry keyed by <details> so opening one card can animate-close others.
// WeakMap lets entries be GC'd automatically when a card is replaced.
const closers = new WeakMap<HTMLDetailsElement, () => void>()

export interface AnimateDetailsHandle {
  /** Animate the <details> closed. No-op if already closed or closing. */
  close: () => void
}

export function animateDetails(
  details: HTMLDetailsElement,
  content: HTMLElement,
  options: { accordionSelector?: string } = {}
): AnimateDetailsHandle {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  let currentAnimation: Animation | null = null
  let isClosing = false

  const runAnimation = (fromHeight: number, toHeight: number, onFinish?: () => void) => {
    currentAnimation?.cancel()
    // Seed the inline style to match the starting keyframe so the first paint
    // after setAttribute('open') never shows the element at its natural height.
    content.style.overflow = 'hidden'
    content.style.height = `${fromHeight}px`
    content.style.opacity = fromHeight === 0 ? '0' : '1'
    const animation = content.animate(
      [
        { height: `${fromHeight}px`, opacity: fromHeight === 0 ? 0 : 1 },
        { height: `${toHeight}px`, opacity: toHeight === 0 ? 0 : 1 }
      ],
      { duration: DURATION_MS, easing: EASING, fill: 'forwards' }
    )
    currentAnimation = animation
    animation.onfinish = () => {
      if (currentAnimation !== animation) return
      currentAnimation = null
      onFinish?.()
      // Remove the forwards fill and the seeded inline styles so the element
      // returns to its stylesheet values (or stays unrendered when closed).
      animation.cancel()
      content.style.overflow = ''
      content.style.height = ''
      content.style.opacity = ''
    }
  }

  const open = () => {
    if (details.open && !isClosing) return

    if (isClosing) {
      // Reverse an in-flight close. The <details> is still [open] at this
      // point — we only remove the attribute at the end of a close animation.
      const currentHeight = content.getBoundingClientRect().height
      isClosing = false
      if (reducedMotion) return
      const targetHeight = content.scrollHeight
      runAnimation(currentHeight, targetHeight)
      return
    }

    details.setAttribute('open', '')
    if (reducedMotion) return
    // scrollHeight is measurable now that the content is in layout.
    const targetHeight = content.scrollHeight
    runAnimation(0, targetHeight)
  }

  const close = () => {
    if (!details.open || isClosing) return

    if (reducedMotion) {
      details.removeAttribute('open')
      return
    }

    const startHeight = content.getBoundingClientRect().height
    isClosing = true
    runAnimation(startHeight, 0, () => {
      details.removeAttribute('open')
      isClosing = false
    })
  }

  const summary = details.querySelector('summary')
  if (!summary) return { close }

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

  return { close }
}
