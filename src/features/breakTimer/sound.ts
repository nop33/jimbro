export const playDingSound = () => {
  try {
    if (typeof AudioContext !== 'function') return

    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5)

    gainNode.gain.setValueAtTime(0.5, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
    // Each ding makes its own context, which holds on to the audio output until it closes.
    osc.addEventListener('ended', () => void ctx.close())
  } catch (err) {
    console.error('Failed to play sound', err)
  }
}
