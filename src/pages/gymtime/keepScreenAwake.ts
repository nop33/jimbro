export const keepScreenAwake = (signal: AbortSignal) => {
  let wakeLock: WakeLockSentinel | null = null
  let requesting = false
  const request = async () => {
    const held = wakeLock !== null && !wakeLock.released
    if (requesting || held || signal.aborted || document.visibilityState !== 'visible') return
    requesting = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (signal.aborted) await lock.release()
      else wakeLock = lock
    } catch (error) {
      console.error('Error requesting wake lock', error)
    } finally {
      requesting = false
    }
  }

  void request()
  document.addEventListener('visibilitychange', () => void request(), { signal })
  signal.addEventListener('abort', () => void wakeLock?.release())
}
