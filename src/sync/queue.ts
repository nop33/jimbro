import { OBJECT_STORES } from '../db/constants'
import type { Storage } from '../db/storage'
import type { Row, RowTable } from '../db/types'
import { rowKey } from './bootstrap'

// A row waiting to be pushed. seq orders the queue and grows with every write of the row. The inflight pair
// records the last push that may have reached the server without an ack: outbox.ts stamps it when it takes the
// entry, and first sync compares the server copy against it.
export interface OutboxEntry {
  key: string
  table: RowTable
  id: string
  seq: number
  inflightSeq?: number
  inflightCanonical?: string
}

// The sync's bookkeeping: seq is the last outbox seq handed out, cursor the highest server revision pulled, and
// bootstrapped marks a first sync that finished with nothing on either side.
export interface MetaRecord {
  name: 'cursor' | 'seq' | 'bootstrapped'
  value: number
}

export const getMeta = async (storage: Storage, name: MetaRecord['name']): Promise<number> => {
  const record = await storage.get<MetaRecord>(OBJECT_STORES.META, name)
  return record?.value ?? 0
}

// The stores a transaction must include to call queueRows.
export const QUEUE_STORES = [OBJECT_STORES.OUTBOX, OBJECT_STORES.META]

// Queues each written row for the next push, in the writer's transaction, so a row is never stored without its
// entry. A row already queued gets the new seq and keeps its inflight stamp, since that push may still have
// reached the server.
export const queueRows = (tx: IDBTransaction, writes: ReadonlyArray<Row>) => {
  const seqRequest = tx.objectStore(OBJECT_STORES.META).get('seq')
  seqRequest.onsuccess = () => {
    let seq = (seqRequest.result as MetaRecord | undefined)?.value ?? 0
    const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
    const queued = writes.map((write) => {
      seq += 1
      return { write, seq, prior: outbox.get(rowKey(write)) }
    })
    tx.objectStore(OBJECT_STORES.META).put({ name: 'seq', value: seq })
    for (const item of queued) {
      item.prior.onsuccess = () => {
        const current = item.prior.result as OutboxEntry | undefined
        const next: OutboxEntry = {
          key: rowKey(item.write),
          table: item.write.table,
          id: item.write.row.id,
          seq: item.seq
        }
        if (current?.inflightSeq !== undefined && current.inflightCanonical !== undefined) {
          next.inflightSeq = current.inflightSeq
          next.inflightCanonical = current.inflightCanonical
        }
        outbox.put(next)
      }
    }
  }
}
