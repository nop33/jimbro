// A popover's light dismiss closes it on a tap outside, but the tap still clicks what it landed on: another set row
// opens its own menu, a logged set opens Edit set. This keeps such a tap to closing the popover. The button that
// toggles the popover keeps its click, since that click is what closes it.
export const tapToDismiss = (popover: HTMLElement) => {
  popover.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return

    // The listeners last until the first tap after the popover closes.
    const listening = new AbortController()
    const { signal } = listening
    const isOpen = () => popover.isConnected && popover.matches(':popover-open')
    let swallowClick = false

    const pointerdown = (event: PointerEvent) => {
      if (!isOpen()) {
        listening.abort()
        return
      }
      const target = event.target instanceof Element ? event.target : null
      swallowClick = !popover.contains(target) && target?.closest('button')?.popoverTargetElement !== popover
    }

    const click = (event: MouseEvent) => {
      if (swallowClick) {
        swallowClick = false
        event.preventDefault()
        event.stopPropagation()
      }
      if (!isOpen()) listening.abort()
    }

    document.addEventListener('pointerdown', pointerdown, { capture: true, signal })
    document.addEventListener('click', click, { capture: true, signal })
  })
}
