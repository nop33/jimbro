// Keeps the screen on while the page shows, until signal aborts. The browser drops the lock when the page is hidden, so
// it is asked for again each time the page is visible.
export const keepScreenAwake = (signal: AbortSignal) => {
  let wakeLock: WakeLockSentinel | null = null
  const request = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      if (signal.aborted) await wakeLock.release()
    } catch (error) {
      console.error('Error requesting wake lock', error)
    }
  }

  void request()
  document.addEventListener(
    'visibilitychange',
    () => {
      if (wakeLock !== null && document.visibilityState === 'visible') void request()
    },
    { signal }
  )
  signal.addEventListener('abort', () => void wakeLock?.release())
}
