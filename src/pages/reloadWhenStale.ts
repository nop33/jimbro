import { getSimpleDate } from '../dateUtils'
import { getWorkoutModeSettings } from '../settings'
import { isOutOfDate } from '../sync/freshness'

// A page drawn once from the day, the workout mode and the database needs loading again when any of them changes
// while it is hidden, unless a dialog is open, which a reload would throw away. It watches until signal aborts, as
// when the next page replaces it.
export const reloadWhenStale = (renderedDay: string, signal: AbortSignal) => {
  const renderedSettings = JSON.stringify(getWorkoutModeSettings())
  const reloadIfStale = async () => {
    if (document.querySelector('dialog[open]')) return
    const stale =
      getSimpleDate(new Date()) !== renderedDay ||
      JSON.stringify(getWorkoutModeSettings()) !== renderedSettings ||
      (await isOutOfDate())
    if (stale) window.location.reload()
  }

  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) void reloadIfStale()
    },
    { signal }
  )
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') void reloadIfStale()
    },
    { signal }
  )
}
