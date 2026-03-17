let audioCtx: AudioContext | null = null

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return audioCtx
}

function playChime(ctx: AudioContext) {
  const duration = 0.5
  const frequencies = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.value = freq

    const startTime = ctx.currentTime + i * 0.05
    gainNode.gain.setValueAtTime(0, startTime)
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05)
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.1)
  })
}

function playMarioSuccess(ctx: AudioContext) {
  const frequencies = [523.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0]
  const noteLength = 0.08

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator() // Now this will work!
    const gainNode = ctx.createGain()

    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)

    const startTime = ctx.currentTime + i * noteLength

    gainNode.gain.setValueAtTime(0, startTime)
    gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + noteLength * 2)

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + noteLength * 2)
  })
}

function playCoin(ctx: AudioContext) {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'square'
  // The "secret sauce": start at B5, flip instantly to E6
  osc.frequency.setValueAtTime(987.77, now)
  osc.frequency.setValueAtTime(1318.51, now + 0.08)

  gain.gain.setValueAtTime(0.2, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start()
  osc.stop(now + 0.5)
}

function playLevelStart(ctx: AudioContext) {
  const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5]
  const tempo = 0.05 // Extremely fast

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.value = freq

    const start = ctx.currentTime + i * tempo
    gain.gain.setValueAtTime(0.1, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.1)
  })
}

function playQuestComplete(ctx: AudioContext) {
  const now = ctx.currentTime
  // C-E-G-B (Major 7th Chord) - very "magical" and happy
  const notes = [523.25, 659.25, 783.99, 987.77]

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle' // Softer, "bell-like" tone
    osc.frequency.setValueAtTime(freq, now + i * 0.1)

    // Fade in and out for a chime effect
    gain.gain.setValueAtTime(0, now + i * 0.1)
    gain.gain.linearRampToValueAtTime(0.2, now + i * 0.1 + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.8)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now + i * 0.1)
    osc.stop(now + 1.0)
  })
}

function playVictoryFanfare(ctx: AudioContext) {
  const now = ctx.currentTime
  // Sequence: G4, G4, G4, C5 (The classic "ta-da!")
  const melody = [
    { f: 392.0, t: 0.0 },
    { f: 392.0, t: 0.15 },
    { f: 392.0, t: 0.3 },
    { f: 523.25, t: 0.45 }
  ]

  melody.forEach((note) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'square'
    osc.frequency.value = note.f

    const start = now + note.t
    const isLast = note.t > 0.4 // Make the last note hold longer

    gain.gain.setValueAtTime(0.1, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (isLast ? 0.6 : 0.1))

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + (isLast ? 0.6 : 0.1))
  })
}

// Main function to randomly select and play a funny sound
export function playFunnySound() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const sounds = [playMarioSuccess, playChime, playCoin, playLevelStart, playQuestComplete, playVictoryFanfare]
    const randomSound = sounds[Math.floor(Math.random() * sounds.length)]
    randomSound(ctx)
  } catch (error) {
    console.warn('Web Audio API play failed:', error)
  }
}
