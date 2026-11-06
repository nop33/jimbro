// The document's one AudioContext, which every sound in the app plays on. A browser lets a context play only once a tap
// has started it: Safari starts one made outside a tap suspended. The break's ding plays from a timer tick, never from
// a tap, so the first tap in the document makes the context and starts it. Once started by a tap, a context may resume
// without one, so it rests suspended between sounds, where it costs nothing, and each sound resumes it.

// How long the context stays awake after a sound, longer than any of the app's sounds.
const REST_AFTER_MS = 2000
// How late a sound may start before it is skipped.
const LATE_MS = 1000

let context: AudioContext | null = null
// Whether a tap has started the context, after which it resumes without one.
let started = false
// A start on its way, which the taps after it leave alone: a browser without an audio device may never settle it.
let starting = false
let rest: ReturnType<typeof setTimeout> | null = null

const restSoon = (ctx: AudioContext) => {
  if (rest !== null) clearTimeout(rest)
  rest = setTimeout(() => {
    rest = null
    void ctx.suspend().catch(() => undefined)
  }, REST_AFTER_MS)
}

// Makes the context and starts it inside the tap, until one tap has.
const start = () => {
  if (started || starting) return
  try {
    if (!context && typeof AudioContext === 'function') context = new AudioContext()
    const ctx = context
    if (!ctx) return
    starting = true
    void ctx
      .resume()
      .then(() => {
        started = ctx.state === 'running'
        if (started) restSoon(ctx)
      })
      .catch(() => undefined)
      .finally(() => {
        starting = false
      })
  } catch (error) {
    console.warn('Web Audio API unavailable:', error)
  }
}

// Lets sounds play after the first tap or key press in the document. The browser counts the release of a touch as the
// tap, not the press, so this listens for pointerup.
export const unlockAudio = () => {
  document.addEventListener('pointerup', start, { capture: true, passive: true })
  document.addEventListener('keydown', start, { capture: true, passive: true })
}

// Plays a sound that play schedules on the context from its currentTime. Before a tap has started the context, the
// sound is skipped, since the browser would not play it.
export const playSound = (play: (ctx: AudioContext) => void) => {
  const ctx = context
  if (!ctx || !started) return
  const asked = Date.now()
  void ctx
    .resume()
    .then(() => {
      // A context the browser woke only at a later tap would play the sound late, so it stays quiet.
      if (ctx.state !== 'running' || Date.now() - asked > LATE_MS) return
      play(ctx)
      restSoon(ctx)
    })
    .catch((error: unknown) => console.warn('Web Audio API play failed:', error))
}
