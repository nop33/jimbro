import { OBJECT_STORES } from '../db/constants'
import { STORE_FOR_TABLE, cloneForIdb, mergeSetGroups, putRow, type Storage } from '../db/storage'
import type { ExerciseRow, ProgramRow, Row, SessionHeader, SetRow } from '../db/types'
import { rowKey, splitRowKey, type BootstrapAction } from './bootstrap'
import type { MetaRecord, OutboxEntry } from './queue'
import { canonical, rowsEqual } from './rows'

// A pulled entry without its revision.
export const rowFromWire = (entry: Row & { rev: number }): Row => {
  switch (entry.table) {
    case 'exercises':
      return { table: 'exercises', row: entry.row }
    case 'programs':
      return { table: 'programs', row: entry.row }
    case 'sessions':
      return { table: 'sessions', row: entry.row }
    case 'sets':
      return { table: 'sets', row: entry.row }
  }
}

const serverStillHasPushedBody = (entry: OutboxEntry | undefined, pulled: Row) =>
  entry?.inflightSeq !== undefined &&
  entry.inflightCanonical !== undefined &&
  entry.seq > entry.inflightSeq &&
  canonical(pulled.row) === entry.inflightCanonical

const syncSetGroups = (tx: IDBTransaction, kept: Array<SetRow>, droppedBySession: Map<string, string[]>) => {
  const sessions = new Set<string>([...droppedBySession.keys(), ...kept.map((set) => set.sessionId)])
  if (sessions.size === 0) return
  const groupStore = tx.objectStore(OBJECT_STORES.SET_GROUPS)
  for (const sessionId of sessions) {
    const request = groupStore.get(sessionId)
    request.onsuccess = () => {
      const drop = new Set(droppedBySession.get(sessionId) ?? [])
      const current = ((request.result?.sets ?? []) as Array<SetRow>).filter((set) => !drop.has(set.id))
      const merged = new Map(current.map((set) => [set.id, set]))
      for (const row of kept) {
        if (row.sessionId === sessionId) merged.set(row.id, cloneForIdb(row))
      }
      groupStore.put({ sessionId, sets: [...merged.values()] })
    }
  }
}

export async function readFirstSyncSnapshot(storage: Storage): Promise<{ seq: number; rows: Row[] }> {
  const db = await storage.connection()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [
        OBJECT_STORES.EXERCISES,
        OBJECT_STORES.PROGRAMS,
        OBJECT_STORES.WORKOUT_SESSIONS,
        OBJECT_STORES.SETS,
        OBJECT_STORES.META
      ],
      'readonly'
    )
    const exercises = tx.objectStore(OBJECT_STORES.EXERCISES).getAll() as IDBRequest<ExerciseRow[]>
    const programs = tx.objectStore(OBJECT_STORES.PROGRAMS).getAll() as IDBRequest<ProgramRow[]>
    const sessions = tx.objectStore(OBJECT_STORES.WORKOUT_SESSIONS).getAll() as IDBRequest<SessionHeader[]>
    const sets = tx.objectStore(OBJECT_STORES.SETS).getAll() as IDBRequest<SetRow[]>
    const seq = tx.objectStore(OBJECT_STORES.META).get('seq') as IDBRequest<MetaRecord | undefined>
    tx.oncomplete = () => {
      const rows: Row[] = [
        ...exercises.result.map((row) => ({ table: 'exercises' as const, row })),
        ...programs.result.map((row) => ({ table: 'programs' as const, row })),
        ...sessions.result.map((row) => ({ table: 'sessions' as const, row })),
        ...sets.result.map((row) => ({ table: 'sets' as const, row }))
      ]
      resolve({ seq: seq.result?.value ?? 0, rows })
    }
    tx.onerror = () => reject(tx.error ?? new Error('readFirstSyncSnapshot failed'))
  })
}

export async function commitFirstSync(
  storage: Storage,
  input: {
    seqAtStart: number
    cursor: number
    actions: Map<string, BootstrapAction>
    pulledByKey: Map<string, Row>
  }
): Promise<void> {
  const db = await storage.connection()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [
        OBJECT_STORES.EXERCISES,
        OBJECT_STORES.PROGRAMS,
        OBJECT_STORES.WORKOUT_SESSIONS,
        OBJECT_STORES.SETS,
        OBJECT_STORES.SET_GROUPS,
        OBJECT_STORES.OUTBOX,
        OBJECT_STORES.META
      ],
      'readwrite'
    )
    const fail = (error: unknown) => {
      try {
        tx.abort()
      } catch {
        // The transaction already finished.
      }
      reject(error instanceof Error ? error : new Error('commitFirstSync failed'))
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => fail(tx.error ?? new Error('commitFirstSync failed'))
    tx.onabort = () => reject(tx.error ?? new Error('commitFirstSync aborted'))
    const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
    const pendingRequest = outbox.getAll()
    pendingRequest.onsuccess = () => {
      const setsRequest = tx.objectStore(OBJECT_STORES.SETS).getAll()
      setsRequest.onsuccess = () => {
        const pending = new Map((pendingRequest.result as OutboxEntry[]).map((entry) => [entry.key, entry]))
        const seqRequest = tx.objectStore(OBJECT_STORES.META).get('seq')
        seqRequest.onsuccess = () => {
          let seq = (seqRequest.result as MetaRecord | undefined)?.value ?? 0
          const keptSets: SetRow[] = []
          const keptSessionExercises = new Map<string, Set<string>>()
          for (const [key, action] of input.actions) {
            const entry = pending.get(key)
            const during = Boolean(entry && entry.seq > input.seqAtStart)
            if (action === 'keepServer') {
              if (during) continue
              const pulled = input.pulledByKey.get(key)
              if (!pulled) continue
              if (serverStillHasPushedBody(entry, pulled)) continue
              putRow(tx, pulled)
              if (pulled.table === 'sets') keptSets.push(pulled.row)
              if (pulled.table === 'sessions') {
                keptSessionExercises.set(
                  pulled.row.id,
                  new Set(pulled.row.exercises.map((exercise) => exercise.exerciseId))
                )
              }
              if (entry) outbox.delete(key)
              continue
            }
            if (action === 'pushLocal') {
              if (entry) continue
              const parts = splitRowKey(key)
              if (!parts) continue
              seq += 1
              outbox.put({ key, table: parts.table, id: parts.id, seq })
              continue
            }
            if (entry && !during) outbox.delete(key)
          }
          const droppedBySession = new Map<string, string[]>()
          for (const set of setsRequest.result as SetRow[]) {
            const exercises = keptSessionExercises.get(set.sessionId)
            if (!exercises || exercises.has(set.exerciseId)) continue
            const key = `sets:${set.id}`
            const entry = pending.get(key)
            if (entry && entry.seq > input.seqAtStart) continue
            if (input.pulledByKey.has(key)) continue
            tx.objectStore(OBJECT_STORES.SETS).delete(set.id)
            outbox.delete(key)
            const dropped = droppedBySession.get(set.sessionId) ?? []
            dropped.push(set.id)
            droppedBySession.set(set.sessionId, dropped)
          }
          syncSetGroups(tx, keptSets, droppedBySession)
          tx.objectStore(OBJECT_STORES.META).put({ name: 'seq', value: seq })
          tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: input.cursor })
        }
      }
    }
  })
}

// Resolves to the rows it stored. A steady sync pulls back the rows it just pushed, and another
// tab's rows are already in this shared database, so a row equal to the stored one is skipped.
export async function commitPullPage(
  storage: Storage,
  page: Array<Row & { rev: number }>,
  cursor: number
): Promise<Row[]> {
  const db = await storage.connection()
  const written: Row[] = []
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [
        OBJECT_STORES.EXERCISES,
        OBJECT_STORES.PROGRAMS,
        OBJECT_STORES.WORKOUT_SESSIONS,
        OBJECT_STORES.SETS,
        OBJECT_STORES.SET_GROUPS,
        OBJECT_STORES.OUTBOX,
        OBJECT_STORES.META
      ],
      'readwrite'
    )
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('commitPullPage failed'))
    tx.onabort = () => reject(tx.error ?? new Error('commitPullPage aborted'))
    const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
    const pendingRequest = outbox.getAll()
    pendingRequest.onsuccess = () => {
      const pending = new Set((pendingRequest.result as OutboxEntry[]).map((entry) => entry.key))
      const incoming = page.map(rowFromWire).filter((row) => !pending.has(rowKey(row)))
      const sets: SetRow[] = []
      let unread = incoming.length
      for (const row of incoming) {
        const storedRequest = tx.objectStore(STORE_FOR_TABLE[row.table]).get(row.row.id)
        storedRequest.onsuccess = () => {
          if (!rowsEqual(storedRequest.result, row.row)) {
            putRow(tx, row)
            written.push(row)
            if (row.table === 'sets') sets.push(row.row)
          }
          unread -= 1
          if (unread === 0) mergeSetGroups(tx, sets)
        }
      }
      tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: cursor })
    }
  })
  return written
}
