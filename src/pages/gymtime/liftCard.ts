// A card moved up or down rises over the neighbour it swaps with, which slides under it into its old place, then glows
// once where it lands, so the eye follows it. Each card plays from where it was to where the new order puts it (FLIP:
// measure, change, play back), so only the cards that moved animate, whatever their heights.

const LIFT_MS = 360
const SLIDE_MS = 300
const GLOW_MS = 700
const GLOW_DELAY_MS = 180
// The --ease-out and --ease-in-out curves in src/style.css. The Web Animations API can't read a CSS variable.
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'
// --color-jim-accent, at the alphas the glow peaks with.
const RING = 'rgb(242 97 63 / 0.9)'
const HALO = 'rgb(242 97 63 / 0.35)'

// Runs move, which reorders card among its siblings, and animates the cards it moved. Resolves with move's result once
// the new order is on screen, without waiting for the animation. Under reduced motion the cards just swap, as they
// always did.
export const liftCard = async <T>(card: HTMLElement, move: () => Promise<T>): Promise<T> => {
  const list = card.parentElement
  if (!list || matchMedia('(prefers-reduced-motion: reduce)').matches) return move()

  // A card still on its way from an earlier move is measured where it shows, so the next move starts from there.
  const cards = [...list.children].filter((child) => child instanceof HTMLElement)
  const before = new Map(cards.map((child) => [child, child.getBoundingClientRect().top]))

  const moved = await move()

  for (const child of cards) {
    const from = before.get(child)
    if (from === undefined || !child.isConnected) continue
    const dy = from - child.getBoundingClientRect().top
    if (Math.abs(dy) < 1) continue
    if (child === card) lift(card, dy)
    else child.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: SLIDE_MS, easing: EASE_OUT })
  }
  return moved
}

const lift = (card: HTMLElement, dy: number) => {
  // The card's background is see-through, so it carries an opaque one while it passes over its neighbour.
  card.classList.add('card-lifted')
  const flight = card.animate(
    [
      { translate: `0 ${dy}px`, scale: '1', boxShadow: '0 0 0 transparent' },
      { translate: `0 ${dy / 2}px`, scale: '1.03', boxShadow: '0 18px 40px rgb(0 0 0 / 0.7)', offset: 0.5 },
      { translate: '0 0', scale: '1', boxShadow: '0 0 0 transparent' }
    ],
    { duration: LIFT_MS, easing: EASE_IN_OUT }
  )
  card.animate(
    [
      { boxShadow: '0 0 0 1px transparent' },
      { boxShadow: `0 0 0 2px ${RING}, 0 0 24px ${HALO}`, offset: 0.3 },
      { boxShadow: '0 0 0 1px transparent' }
    ],
    { duration: GLOW_MS, delay: GLOW_DELAY_MS, easing: 'ease-out' }
  )
  // A later move cancels the flight; the card settles either way.
  void flight.finished.catch(() => undefined).finally(() => card.classList.remove('card-lifted'))
}
