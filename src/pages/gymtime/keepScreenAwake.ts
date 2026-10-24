// Keeps the screen on while the gymtime page shows, until signal aborts as the next page replaces it. The browser
// drops the lock whenever the page is hidden, so it is asked for again each time the page shows.
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
      if (document.visibilityState === 'visible') void request()
    },
    { signal }
  )
  signal.addEventListener('abort', () => void wakeLock?.release())
}
