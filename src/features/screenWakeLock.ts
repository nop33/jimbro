export const screenWakeLock = (signal: AbortSignal) => {
  let wanted = false
  let wakeLock: WakeLockSentinel | null = null
  let requesting = false
  const request = async () => {
    const held = wakeLock !== null && !wakeLock.released
    if (!wanted || requesting || held || signal.aborted || document.visibilityState !== 'visible') return
    requesting = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (signal.aborted || !wanted) await lock.release()
      else wakeLock = lock
    } catch (error) {
      console.error('Error requesting wake lock', error)
    } finally {
      requesting = false
    }
  }

  document.addEventListener('visibilitychange', () => void request(), { signal })
  signal.addEventListener('abort', () => void wakeLock?.release())
  return (keepAwake: boolean) => {
    wanted = keepAwake
    if (keepAwake) {
      void request()
      return
    }
    void wakeLock?.release()
    wakeLock = null
  }
}
