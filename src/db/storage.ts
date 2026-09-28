import { rowKey, splitRowKey, type BootstrapAction } from '../sync/bootstrap'
import { announce } from '../sync/pageChannel'
import {
  canonical,
  rowsEqual,
  type ExerciseRow,
  type ProgramRow,
  type Row,
  type RowTable,
  type SessionHeader,
  type SetRow
} from '../sync/rows'
import { DB_NAME, OBJECT_STORES } from './constants'
import { createCurrentObjectStores, getLatestDbVersion, getMigrationForVersion } from './migrations'
import { promisifyRequest } from './promisifyRequest'

const STORE_FOR_TABLE: Record<RowTable, string> = {
  exercises: OBJECT_STORES.EXERCISES,
  programs: OBJECT_STORES.PROGRAMS,
  sessions: OBJECT_STORES.WORKOUT_SESSIONS,
  sets: OBJECT_STORES.SETS
}

const cloneForIdb = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T

export interface OutboxEntry {
  key: string
  table: RowTable
  id: string
  seq: number
  inflightSeq?: number
  inflightCanonical?: string
}

const serverStillHasPushedBody = (entry: OutboxEntry | undefined, pulled: Row) =>
  entry?.inflightSeq !== undefined &&
  entry.inflightCanonical !== undefined &&
  entry.seq > entry.inflightSeq &&
  canonical(pulled.row) === entry.inflightCanonical

interface MetaRecord {
  name: 'cursor' | 'seq' | 'bootstrapped'
  value: number
}

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

const mergeSetGroups = (tx: IDBTransaction, sets: Array<SetRow>) => {
  if (sets.length === 0) return
  const bySession = new Map<string, Array<SetRow>>()
  for (const set of sets) {
    const list = bySession.get(set.sessionId) ?? []
    list.push(cloneForIdb(set))
    bySession.set(set.sessionId, list)
  }
  const groupStore = tx.objectStore(OBJECT_STORES.SET_GROUPS)
  for (const [sessionId, rows] of bySession) {
    const request = groupStore.get(sessionId)
    request.onsuccess = () => {
      const current = (request.result?.sets ?? []) as Array<SetRow>
      const merged = new Map(current.map((set) => [set.id, set]))
      for (const row of rows) merged.set(row.id, row)
      groupStore.put({ sessionId, sets: [...merged.values()] })
    }
  }
}

const putRow = (tx: IDBTransaction, row: Row) => {
  tx.objectStore(STORE_FOR_TABLE[row.table]).put(cloneForIdb(row.row))
}

const rowFromWire = (entry: Row & { rev: number }): Row => {
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

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log('Storage will not be cleared except by explicit user action')
    } else {
      console.log('Storage may be cleared by the UA under storage pressure.')
    }
  })
}

const openDatabase = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const latestVersion = getLatestDbVersion()
    const request = window.indexedDB.open(DB_NAME, latestVersion)

    request.onsuccess = (event) => {
      console.log('✅ Opened DB connection', event)
      resolve(request.result)
    }

    request.onerror = (event) => {
      console.error('❌ Could not open DB connection', event)
      reject(request.error)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const transaction = (event.target as IDBOpenDBRequest).transaction!
      const oldVersion = event.oldVersion

      // Fresh DBs skip v1–v4 (v4 deletes workoutSessions mid-upgrade). Create v5 stores directly.
      if (oldVersion === 0) {
        createCurrentObjectStores(db)
        transaction.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: 0 })
        return
      }

      for (let versionToMigrateTo = oldVersion + 1; versionToMigrateTo <= latestVersion; versionToMigrateTo++) {
        // v5 and v6 rewrite these records on cursors. v7 splits them in this same
        // transaction, so those cursors would put the nested sessions back.
        if (latestVersion >= 7 && versionToMigrateTo >= 5 && versionToMigrateTo < 7) continue
        getMigrationForVersion(versionToMigrateTo)?.(db, transaction)
      }
    }
  })
}

export class Storage {
  private db: IDBDatabase | null = null
  private opening: Promise<IDBDatabase> | null = null

  private async init(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (!this.opening) {
      this.opening = openDatabase().then((db) => {
        this.db = db
        return db
      })
    }
    return this.opening
  }

  async connection(): Promise<IDBDatabase> {
    return this.init()
  }

  async writeRows(writes: Array<Row>): Promise<void> {
    if (writes.length === 0) return
    const db = await this.init()
    const storeNames = [...new Set(writes.map((write) => STORE_FOR_TABLE[write.table]))]
    storeNames.push(OBJECT_STORES.OUTBOX, OBJECT_STORES.META)
    const setWrites = writes.filter((write): write is { table: 'sets'; row: SetRow } => write.table === 'sets')
    if (setWrites.length > 0) storeNames.push(OBJECT_STORES.SET_GROUPS)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite')
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        try {
          tx.abort()
        } catch {
          // The transaction already finished.
        }
        reject(error)
      }
      tx.oncomplete = () => {
        if (settled) return
        settled = true
        resolve()
      }
      tx.onerror = () => fail(tx.error ?? new Error('writeRows failed'))
      tx.onabort = () => fail(tx.error ?? new Error('writeRows aborted'))
      try {
        for (const write of writes) putRow(tx, write)
        mergeSetGroups(
          tx,
          setWrites.map((write) => write.row)
        )
        const seqRequest = tx.objectStore(OBJECT_STORES.META).get('seq')
        seqRequest.onsuccess = () => {
          if (settled) return
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
      } catch (error) {
        fail(error)
      }
    })
    window.dispatchEvent(new CustomEvent('jimbro:rows-written'))
    announce('rows-written')
  }

  async getMeta(name: MetaRecord['name']): Promise<number> {
    const record = await this.get<MetaRecord>(OBJECT_STORES.META, name)
    return record?.value ?? 0
  }

  async setMeta(name: MetaRecord['name'], value: number): Promise<void> {
    const db = await this.init()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([OBJECT_STORES.META], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('setMeta failed'))
      tx.objectStore(OBJECT_STORES.META).put({ name, value })
    })
  }

  async readOutbox(limit: number): Promise<OutboxEntry[]> {
    const all = await this.getAll<OutboxEntry>(OBJECT_STORES.OUTBOX)
    all.sort((left, right) => left.seq - right.seq)
    return all.slice(0, limit)
  }

  async readFirstSyncSnapshot(): Promise<{ seq: number; rows: Row[] }> {
    const db = await this.init()
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

  async commitFirstSync(input: {
    seqAtStart: number
    cursor: number
    actions: Map<string, BootstrapAction>
    pulledByKey: Map<string, Row>
  }): Promise<void> {
    const db = await this.init()
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
  async commitPullPage(page: Array<Row & { rev: number }>, cursor: number): Promise<Row[]> {
    const db = await this.init()
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

  async readOutboxRows(entries: OutboxEntry[]): Promise<{
    rows: Row[]
    sent: Array<{ key: string; seq: number }>
    missing: Array<{ key: string; seq: number }>
  }> {
    if (entries.length === 0) return { rows: [], sent: [], missing: [] }
    const db = await this.init()
    const rows: Row[] = []
    const sent: Array<{ key: string; seq: number }> = []
    const missing: Array<{ key: string; seq: number }> = []
    await new Promise<void>((resolve, reject) => {
      const names = [...new Set(entries.map((entry) => STORE_FOR_TABLE[entry.table]))]
      const tx = db.transaction(names, 'readonly')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('readOutboxRows failed'))
      for (const entry of entries) {
        const request = tx.objectStore(STORE_FOR_TABLE[entry.table]).get(entry.id)
        request.onsuccess = () => {
          if (request.result === undefined) {
            missing.push({ key: entry.key, seq: entry.seq })
            return
          }
          sent.push({ key: entry.key, seq: entry.seq })
          if (entry.table === 'exercises') rows.push({ table: 'exercises', row: request.result })
          else if (entry.table === 'programs') rows.push({ table: 'programs', row: request.result })
          else if (entry.table === 'sessions') rows.push({ table: 'sessions', row: request.result })
          else rows.push({ table: 'sets', row: request.result })
        }
      }
    })
    return { rows, sent, missing }
  }

  async markOutboxInflight(
    marks: Array<{ key: string; seq: number; body: string }>
  ): Promise<Array<{ key: string; seq: number }>> {
    if (marks.length === 0) return []
    const db = await this.init()
    const kept: Array<{ key: string; seq: number }> = []
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([OBJECT_STORES.OUTBOX], 'readwrite')
      const store = tx.objectStore(OBJECT_STORES.OUTBOX)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('markOutboxInflight failed'))
      for (const mark of marks) {
        const request = store.get(mark.key)
        request.onsuccess = () => {
          const current = request.result as OutboxEntry | undefined
          if (!current || current.seq < mark.seq) return
          if (current.inflightSeq === undefined || current.inflightCanonical === undefined) {
            store.put({ ...current, inflightSeq: mark.seq, inflightCanonical: mark.body })
          }
          kept.push({ key: mark.key, seq: mark.seq })
        }
      }
    })
    return kept
  }

  async outboxKeysPresent(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set()
    const db = await this.init()
    const present = new Set<string>()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([OBJECT_STORES.OUTBOX], 'readonly')
      const store = tx.objectStore(OBJECT_STORES.OUTBOX)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('outboxKeysPresent failed'))
      for (const key of keys) {
        const request = store.get(key)
        request.onsuccess = () => {
          if (request.result) present.add(key)
        }
      }
    })
    return present
  }

  async deleteOutboxIfUnchanged(
    entries: Array<{ key: string; seq: number }>,
    advance?: { cursor?: number; bootstrapped?: number }
  ): Promise<void> {
    if (entries.length === 0) return
    const db = await this.init()
    await new Promise<void>((resolve, reject) => {
      const names = advance ? [OBJECT_STORES.OUTBOX, OBJECT_STORES.META] : [OBJECT_STORES.OUTBOX]
      const tx = db.transaction(names, 'readwrite')
      const store = tx.objectStore(OBJECT_STORES.OUTBOX)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('deleteOutboxIfUnchanged failed'))
      if (advance?.cursor !== undefined) {
        tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: advance.cursor })
      }
      if (advance?.bootstrapped !== undefined) {
        tx.objectStore(OBJECT_STORES.META).put({ name: 'bootstrapped', value: advance.bootstrapped })
      }
      for (const entry of entries) {
        const request = store.get(entry.key)
        request.onsuccess = () => {
          const current = request.result as OutboxEntry | undefined
          if (current && current.seq === entry.seq) store.delete(entry.key)
        }
      }
    })
  }

  async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    let db = this.db

    if (!db) {
      db = await this.init()
    }

    const transaction = db.transaction([storeName], mode)

    return transaction.objectStore(storeName)
  }

  async create<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.add(item))
    return item
  }

  async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const result = await promisifyRequest<T | undefined>(store.get(key))
    return result
  }

  async update<T>(storeName: string, item: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.put(item))
    return item
  }

  async getByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return promisifyRequest<T | undefined>(index.get(key))
  }

  async getAllByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<Array<T>> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return promisifyRequest(index.getAll(key))
  }

  async getFirstByIndex<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection = 'next'
  ): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(null, direction)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        resolve(cursor ? (cursor.value as T) : undefined)
      }
      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
  }

  async getFirstByPredicate<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection = 'next',
    predicate: (value: T) => boolean
  ): Promise<T | undefined> {
    const store = await this.getStore(storeName)
    const index = store.index(indexName)
    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, direction)
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          if (predicate(cursor.value as T)) {
            resolve(cursor.value as T)
          } else {
            cursor.continue()
          }
        } else {
          resolve(undefined)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getAll<T>(storeName: string): Promise<Array<T>> {
    const store = await this.getStore(storeName)
    return promisifyRequest(store.getAll())
  }

  async count(storeName: string): Promise<number> {
    const store = await this.getStore(storeName)
    return promisifyRequest(store.count())
  }

  async deleteDatabase() {
    this.db?.close()
    this.db = null
    this.opening = null
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('deleteDatabase blocked'))
    })
  }

  async delete(storeName: string, key: string | number): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite')
    await promisifyRequest(store.delete(key))
  }
}

export const storage = new Storage()
