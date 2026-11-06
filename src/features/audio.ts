// The document's one AudioContext, which every sound in the app plays on. A browser lets a context play only once a tap
// has let it: Safari starts one made outside a tap suspended, and suspends it again when the app leaves the screen.
// The break's ding plays from a timer tick, never from a tap, so the context is made and resumed by the taps
// themselves, and is running by the time a break ends.

let context: AudioContext | null = null

const audioContext = () => {
  if (!context && typeof AudioContext === 'function') context = new AudioContext()
  return context
}

// A resume on its way, which the taps after it leave alone: a browser without an audio device may never settle it.
let waking: Promise<void> | null = null

// Makes the context, or wakes it, inside the tap.
const wake = () => {
  if (waking) return
  try {
    const ctx = audioContext()
    if (!ctx || ctx.state === 'running') return
    waking = ctx
      .resume()
      .catch(() => undefined)
      .finally(() => {
        waking = null
      })
  } catch (error) {
    console.warn('Web Audio API unavailable:', error)
  }
}

// Lets sounds play after any tap or key press in the document. The browser counts the release of a touch as the tap,
// not the press, so this listens for pointerup.
export const unlockAudio = () => {
  document.addEventListener('pointerup', wake, { capture: true, passive: true })
  document.addEventListener('keydown', wake, { capture: true, passive: true })
}

// Plays a sound that play schedules on the context from its currentTime. Before the first tap, or while the browser
// keeps the context suspended, the sound is skipped: it would otherwise play late, at the next tap.
export const playSound = (play: (ctx: AudioContext) => void) => {
  try {
    if (context?.state === 'running') play(context)
  } catch (error) {
    console.warn('Web Audio API play failed:', error)
  }
}
