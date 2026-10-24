import { playFunnySound } from './sounds'

// Celebrations for a finished exercise (popConfetti) and a finished workout (stampConfetti). Both move pieces with the
// Web Animations API on transform and opacity only, which the compositor plays even while the page re-renders the
// cards and downloads the export. Under reduced motion only the message fades in and out. src/style.css styles the
// layer and its parts.

const COLORS = ['#f2613f', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#fde68a'] as const
// The --ease-out curve in src/style.css. The Web Animations API can't read a CSS variable.
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const EASE_IN = 'cubic-bezier(0.5, 0, 0.75, 0)'

const random = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T>(list: ReadonlyArray<T>): T => list[Math.floor(Math.random() * list.length)]
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

let shown: HTMLElement | undefined

// A new celebration replaces one still playing.
const openLayer = (): HTMLElement => {
  shown?.remove()
  const layer = document.createElement('div')
  layer.className = 'confetti'
  layer.popover = 'manual'
  layer.dataset.persist = ''
  document.body.append(layer)
  layer.showPopover()
  shown = layer
  return layer
}

const closeWhenDone = (layer: HTMLElement, animations: Array<Animation>) => {
  const close = () => {
    layer.remove()
    if (shown === layer) shown = undefined
  }
  void Promise.all(animations.map((animation) => animation.finished)).then(close, close)
}

// The message pops in, holds and fades out. A stamp drops onto the screen from above at a tilt instead.
const showMessage = (layer: HTMLElement, text: string, { holdMs, stamp }: { holdMs: number; stamp: boolean }) => {
  const message = document.createElement('div')
  message.className = 'confetti-text'
  message.setAttribute('role', 'status')
  message.textContent = text
  layer.append(message)
  const enter = stamp ? 260 : 420
  const duration = enter + holdMs + 260
  const at = (ms: number) => ms / duration
  if (reducedMotion()) {
    return message.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
      {
        duration,
        fill: 'both'
      }
    )
  }
  const tilt = stamp ? 'rotate(-4deg)' : ''
  const keyframes: Array<Keyframe> = stamp
    ? [
        { opacity: 0, transform: 'scale(1.8) rotate(-9deg)', easing: EASE_IN },
        { opacity: 1, transform: `scale(0.96) ${tilt}`, offset: at(enter * 0.7), easing: EASE_OUT },
        { opacity: 1, transform: `scale(1) ${tilt}`, offset: at(enter) },
        { opacity: 1, transform: `scale(1) ${tilt}`, offset: at(enter + holdMs), easing: 'ease-in' },
        { opacity: 0, transform: `scale(0.96) ${tilt} translateY(-6px)` }
      ]
    : [
        { opacity: 0, transform: 'scale(0.6)', easing: EASE_OUT },
        { opacity: 1, transform: 'scale(1.05)', offset: at(enter * 0.55), easing: 'ease-in-out' },
        { opacity: 1, transform: 'scale(1)', offset: at(enter) },
        { opacity: 1, transform: 'scale(1)', offset: at(enter + holdMs), easing: 'ease-in' },
        { opacity: 0, transform: 'scale(0.96) translateY(-6px)' }
      ]
  return message.animate(keyframes, { duration, fill: 'both' })
}

type Flight = { x: number; y: number; vx: number; vy: number; gravity: number; drag: number; duration: number }

// Samples a piece's flight: launched at (vx, vy) px/s, slowed by air drag and pulled down by gravity, as it spins and
// flips like paper. The keyframes are linear, since the samples already carry the physics.
const flightKeyframes = ({ x, y, vx, vy, gravity, drag, duration }: Flight): Array<Keyframe> => {
  const steps = 30
  const substeps = 4
  const dt = duration / 1000 / steps / substeps
  const spin = random(-720, 720)
  const flip = random(360, 1080) * pick([-1, 1])
  const sway = random(3, 8)
  const swayPhase = random(0, Math.PI * 2)
  const swaySpeed = random(3, 6)
  const fadeFrom = 0.6
  const keyframes: Array<Keyframe> = []
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const swayX = sway * Math.sin(swayPhase + t * (duration / 1000) * swaySpeed)
    keyframes.push({
      transform: `translate(${x + swayX}px, ${y}px) rotate(${spin * t}deg) rotateX(${flip * t}deg)`,
      opacity: t <= fadeFrom ? 1 : (1 - t) / (1 - fadeFrom)
    })
    for (let sub = 0; sub < substeps; sub++) {
      vx *= Math.exp(-drag * dt)
      vy = vy * Math.exp(-drag * dt) + gravity * dt
      x += vx * dt
      y += vy * dt
    }
  }
  return keyframes
}

const addPiece = (layer: HTMLElement, size: number): HTMLElement => {
  const piece = document.createElement('i')
  const round = Math.random() < 0.25
  const width = round ? size * 0.7 : size
  const height = round ? size * 0.7 : size * random(0.4, 0.6)
  piece.className = 'confetti-piece'
  piece.style.width = `${width}px`
  piece.style.height = `${height}px`
  piece.style.margin = `${-height / 2}px 0 0 ${-width / 2}px`
  piece.style.background = pick(COLORS)
  piece.style.borderRadius = round ? '50%' : '1.5px'
  layer.append(piece)
  return piece
}

// The point a burst comes from, kept on screen when the element has scrolled out of view.
const cornerOf = (element: Element | null): { x: number; y: number } | undefined => {
  if (!element) return undefined
  const box = element.getBoundingClientRect()
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 16), max - 16)
  return { x: clamp(box.right, window.innerWidth), y: clamp(box.top, window.innerHeight) }
}

// A finished exercise: a small burst upwards from the corner of its card, where the done check appears.
export const popConfetti = (text: string, card: Element | null) => {
  playFunnySound()
  const layer = openLayer()
  const animations = [showMessage(layer, text, { holdMs: 1100, stamp: false })]
  if (!reducedMotion()) {
    const height = window.innerHeight
    const from = cornerOf(card) ?? { x: window.innerWidth / 2, y: height * 0.42 }
    for (let i = 0; i < 36; i++) {
      const angle = random(-Math.PI * 0.95, -Math.PI * 0.05)
      const speed = random(0.35, 0.8) * height
      const flight = {
        x: from.x,
        y: from.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: height * 1.1,
        drag: 3.2,
        duration: random(1000, 1400)
      }
      animations.push(
        addPiece(layer, random(5, 9)).animate(flightKeyframes(flight), { duration: flight.duration, fill: 'both' })
      )
    }
  }
  closeWhenDone(layer, animations)
}

// A finished workout: the message stamps onto the screen, and rings and sparks go out from it.
export const stampConfetti = (text: string) => {
  playFunnySound()
  const layer = openLayer()
  const animations = [showMessage(layer, text, { holdMs: 1600, stamp: true })]
  if (!reducedMotion()) {
    const cx = window.innerWidth / 2
    const cy = window.innerHeight * 0.42
    const ringSize = Math.min(window.innerWidth * 0.7, 300)
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement('i')
      ring.className = 'confetti-ring'
      ring.style.width = ring.style.height = `${ringSize}px`
      ring.style.left = `${cx - ringSize / 2}px`
      ring.style.top = `${cy - ringSize / 2}px`
      layer.prepend(ring)
      animations.push(
        ring.animate(
          [
            { transform: 'scale(0.3)', opacity: 0.9 },
            { transform: 'scale(1.6)', opacity: 0 }
          ],
          { duration: 700, delay: 180 + i * 160, easing: EASE_OUT, fill: 'both' }
        )
      )
    }
    const sparks = 24
    const near = Math.min(window.innerWidth * 0.36, 150)
    for (let i = 0; i < sparks; i++) {
      const spark = document.createElement('i')
      const degrees = (360 * i) / sparks + random(-6, 6)
      const far = near + random(40, 120)
      spark.className = 'confetti-spark'
      spark.style.left = `${cx}px`
      spark.style.top = `${cy}px`
      spark.style.width = `${random(10, 18)}px`
      spark.style.background = pick(COLORS)
      layer.prepend(spark)
      animations.push(
        spark.animate(
          [
            { transform: `rotate(${degrees}deg) translateX(${near * 0.6}px) scaleX(0.4)`, opacity: 0 },
            { transform: `rotate(${degrees}deg) translateX(${near}px) scaleX(1)`, opacity: 1, offset: 0.25 },
            { transform: `rotate(${degrees}deg) translateX(${far}px) scaleX(0.3)`, opacity: 0 }
          ],
          { duration: 650, delay: 180, easing: EASE_OUT, fill: 'both' }
        )
      )
    }
  }
  closeWhenDone(layer, animations)
}
