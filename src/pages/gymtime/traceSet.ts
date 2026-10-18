// A logged set's row draws its new solid border: a green stroke runs around it clockwise from the top left corner, a
// little brighter than the border it leaves, then fades into it. The break timer waits for it (openSession), so the
// lifter sees the set land before the countdown covers the screen.

const SVG = 'http://www.w3.org/2000/svg'
const DRAW_MS = 520
const SETTLE_MS = 260
// The --ease-out curve in src/style.css, and a symmetric one for the stroke, which travels rather than enters. The Web
// Animations API can't read a CSS variable.
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'
// The stroke's colour in .set-trace, at the alpha a glow fades out from.
const GLOW = 'rgb(111 212 127 / 0.45)'

// The row's rounded rectangle, from its top left corner, clockwise, along the middle of its 1px border.
const outline = (width: number, height: number, radius: number): string => {
  const a = 0.5
  const r = Math.min(radius, (height - 1) / 2)
  const arc = (x: number, y: number) => `A${r},${r} 0 0 1 ${x},${y}`
  return [
    `M${a + r},${a}`,
    `H${width - a - r}`,
    arc(width - a, a + r),
    `V${height - a - r}`,
    arc(width - a - r, height - a),
    `H${a + r}`,
    arc(a, height - a - r),
    `V${a + r}`,
    arc(a + r, a)
  ].join(' ')
}

// Resolves once the row shows its own border again. Under reduced motion the row just changes, as it always did.
export const traceSet = async (row: HTMLElement): Promise<void> => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const { width, height } = row.getBoundingClientRect()
  if (width === 0 || height === 0) return
  const border = getComputedStyle(row).borderTopColor

  const svg = document.createElementNS(SVG, 'svg')
  svg.classList.add('set-trace')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', outline(width, height, parseFloat(getComputedStyle(row).borderTopLeftRadius) || 0))
  svg.append(path)
  row.append(svg)
  const length = path.getTotalLength()
  path.style.strokeDasharray = `${length} ${length}`

  // The row comes up from the faded look of a set to do, and its values rise into place, while the stroke draws.
  row.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: DRAW_MS, easing: 'ease-out' })
  row.querySelectorAll('.set-fields > *').forEach((field, index) =>
    field.animate(
      [
        { opacity: 0, translate: '0 6px' },
        { opacity: 1, translate: '0 0' }
      ],
      {
        duration: 300,
        delay: 120 + index * 40,
        easing: EASE_OUT,
        fill: 'backwards'
      }
    )
  )
  const hidden = row.animate([{ borderColor: 'transparent' }, { borderColor: 'transparent' }], {
    duration: DRAW_MS,
    fill: 'forwards'
  })

  try {
    await path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
      duration: DRAW_MS,
      easing: EASE_IN_OUT,
      fill: 'forwards'
    }).finished
    hidden.cancel()
    row.animate([{ borderColor: 'transparent' }, { borderColor: border }], { duration: SETTLE_MS, easing: 'ease-out' })
    row.animate([{ boxShadow: `0 0 0 0 ${GLOW}` }, { boxShadow: '0 0 14px 1px transparent' }], {
      duration: 420,
      easing: 'ease-out'
    })
    await path.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, easing: 'ease-out', fill: 'forwards' })
      .finished
  } catch {
    // A later session redrew the row, which took the animations with it.
  } finally {
    hidden.cancel()
    svg.remove()
  }
}
