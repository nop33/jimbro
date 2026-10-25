export const playDingSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContext) return

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
  } catch (err) {
    console.error('Failed to play sound', err)
  }
}
