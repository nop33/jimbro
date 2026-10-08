import { storage } from '../db/storage'
import { onPageNotice } from './pageChannel'
import { getMeta } from './queue'

// seq grows with every local write and cursor with every pull, so the pair moves whenever the database changes.
const readVersion = async () => `${await getMeta(storage, 'seq')}:${await getMeta(storage, 'cursor')}`

// The version this page shows. A page renders its own writes, so each of this tab's writes moves it along.
let shown = readVersion()
onPageNotice((notice, source) => {
  if (notice === 'rows-written' && source === 'this-tab') shown = readVersion()
})

// True when another page, tab or sync changed the database since this page rendered it.
export const isOutOfDate = async () => (await readVersion()) !== (await shown)
