import { storage } from '../db/storage'
import { onPageNotice } from './pageChannel'
import { getMeta } from './queue'

// seq grows with every local write and cursor with the first sync, so the pair moves whenever the database changes.
const readVersion = async () => `${await getMeta(storage, 'seq')}:${await getMeta(storage, 'cursor')}`

// The version the page on screen shows. A page renders its own writes, so each of its writes moves it along.
let shown = readVersion()
onPageNotice((notice) => {
  if (notice === 'rows-written') shown = readVersion()
})

// The router calls it each time it has drawn a page from the database.
export const markRendered = () => {
  shown = readVersion()
}

// True when a sync or another tab changed the database since the page on screen rendered it. A document that Back or
// Forward restored from the back/forward cache misses what was written meanwhile.
export const isOutOfDate = async () => (await readVersion()) !== (await shown)
