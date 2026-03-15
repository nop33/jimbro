let wakeLock: WakeLockSentinel | null = null

export const keepScreenAwake = async () => {
  try {
    wakeLock = await navigator.wakeLock.request('screen')
  } catch (error) {
    console.error('Error requesting wake lock', error)
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await keepScreenAwake()
  }
})
