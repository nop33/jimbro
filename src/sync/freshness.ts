import { storage } from '../db/storage'
import { onPageNotice } from './pageChannel'
import { getMeta } from './queue'

const readRowsSeq = () => getMeta(storage, 'seq')

let renderedSeq = readRowsSeq()
onPageNotice((notice) => {
  if (notice === 'rows-written') renderedSeq = readRowsSeq()
})

// The router calls it each time it has drawn a page from the database.
export const markRendered = () => {
  renderedSeq = readRowsSeq()
}

// True when a first sync, or a write in another document, changed the rows since the page on screen rendered them. A
// document that Back or Forward restored from the back/forward cache misses what was written meanwhile.
export const isOutOfDate = async () => (await readRowsSeq()) !== (await renderedSeq)
