// Create an audio context
let audioCtx: AudioContext | null = null

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return audioCtx
}

// 1. A classic 'boing' sound
function playBoing(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, ctx.currentTime)
  // Frequency sweeps up then down
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1)
  osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3)

  gainNode.gain.setValueAtTime(0, ctx.currentTime)
  gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05)
  gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)

  osc.connect(gainNode)
  gainNode.connect(ctx.destination)

  osc.start()
  osc.stop(ctx.currentTime + 0.5)
}

// 2. A 'pew pew' laser sound
function playPew(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()

  osc.type = 'square'
  osc.frequency.setValueAtTime(900, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2)

  gainNode.gain.setValueAtTime(1, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)

  osc.connect(gainNode)
  gainNode.connect(ctx.destination)

  osc.start()
  osc.stop(ctx.currentTime + 0.2)
}

// 3. A happy 'chime' chord
function playChime(ctx: AudioContext) {
  const duration = 0.5
  const frequencies = [523.25, 659.25, 783.99, 1046.50] // C5, E5, G5, C6

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.value = freq

    const startTime = ctx.currentTime + (i * 0.05)
    gainNode.gain.setValueAtTime(0, startTime)
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05)
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.start(startTime)
    osc.stop(startTime + duration + 0.1)
  })
}

// 4. A 'whip' or slide whistle sound
function playSlide(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()

  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(200, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2)

  gainNode.gain.setValueAtTime(0, ctx.currentTime)
  gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1)
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3)

  osc.connect(gainNode)
  gainNode.connect(ctx.destination)

  osc.start()
  osc.stop(ctx.currentTime + 0.3)
}

// Main function to randomly select and play a funny sound
export function playFunnySound() {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    const sounds = [playBoing, playPew, playChime, playSlide]
    const randomSound = sounds[Math.floor(Math.random() * sounds.length)]
    randomSound(ctx)
  } catch (error) {
    console.warn('Web Audio API play failed:', error)
  }
}
