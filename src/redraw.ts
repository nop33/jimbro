import { getSimpleDate } from './dateUtils'
import { onPageNotice } from './sync/pageChannel'
import { isOutOfDate } from './sync/freshness'

// Draws the page on screen again from the database, in this document: the router loads its markup and mounts it
// afresh, keeping what outlives a page (the break timer, toasts, confetti) and the scroll position. Before the router
// registers its own, or wherever it cannot, the page loads again in full.
let redrawPage = async () => {
  window.location.reload()
}

// A redraw asked for while one runs, as when a restore's sync settles and its button redraws too, joins it.
let drawing: Promise<void> | undefined
export const redraw = () => {
  drawing ??= redrawPage().finally(() => {
    drawing = undefined
  })
  return drawing
}

// The day the page on screen was drawn for, by a page that shows the day, until its signal aborts.
let drawnFor: { day: string; signal: AbortSignal } | undefined

// A page that shows today, such as the home week card or the workouts calendar, draws again once the day changes.
export const redrawOnNewDay = (day: string, signal: AbortSignal) => {
  drawnFor = { day, signal }
}

// What a redraw would throw away: an open dialog, or a field the user is typing in.
const busy = () =>
  document.querySelector('dialog[open]') !== null ||
  document.activeElement?.matches('input, textarea, select, [contenteditable]') === true

const newDay = () => drawnFor !== undefined && !drawnFor.signal.aborted && getSimpleDate(new Date()) !== drawnFor.day

// Redraws the page on screen when what it shows changed since it drew: a first sync restored rows, Back or Forward
// brought back a document from the back/forward cache that missed later writes, or the day changed. Pages draw their
// own writes, so those never count.
const redrawIfStale = async () => {
  if (busy()) return
  if (newDay() || (await isOutOfDate())) await redraw()
}

// The router hands over its redraw once, and from then on every page stays fresh the same way: when the app comes back
// into view, when Back or Forward restores a document from the back/forward cache, and when a sync settles.
export const keepPagesFresh = (redrawInPlace: () => Promise<void>) => {
  redrawPage = redrawInPlace
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void redrawIfStale()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void redrawIfStale()
  })
  onPageNotice((notice) => {
    if (notice === 'sync-settled') void redrawIfStale()
  })
}
