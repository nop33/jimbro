import { storage } from '../db/storage'
import { onPageNotice } from './pageChannel'
import { getMeta } from './queue'

// seq grows with every local write and cursor with the first sync, so the pair moves whenever the database changes.
const readVersion = async () => `${await getMeta(storage, 'seq')}:${await getMeta(storage, 'cursor')}`

// The version this page shows. A page renders its own writes, so each of its writes moves it along.
let shown = readVersion()
onPageNotice((notice) => {
  if (notice === 'rows-written') shown = readVersion()
})

// True when another page or a sync changed the database since this page rendered it. A page that Back or Forward
// restored, or one prerendered before the tap, misses what the pages shown in between wrote.
export const isOutOfDate = async () => (await readVersion()) !== (await shown)
