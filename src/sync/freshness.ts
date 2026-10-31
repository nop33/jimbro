import { storage } from '../db/storage'
import { onPageNotice } from './pageChannel'
import { getMeta } from './queue'

// seq grows with every write of rows: each local write, and a first sync that restored rows. Pushes and acks leave it,
// so a sync that only backs up never makes a page stale.
const readVersion = () => getMeta(storage, 'seq')

// The version the page on screen shows. A page renders its own writes, so each of its writes moves it along.
let shown = readVersion()
onPageNotice((notice) => {
  if (notice === 'rows-written') shown = readVersion()
})

// The router calls it each time it has drawn a page from the database.
export const markRendered = () => {
  shown = readVersion()
}

// True when a first sync, or a write in another document, changed the rows since the page on screen rendered them. A
// document that Back or Forward restored from the back/forward cache misses what was written meanwhile.
export const isOutOfDate = async () => (await readVersion()) !== (await shown)
