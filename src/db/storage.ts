import { rowKey, splitRowKey, type BootstrapAction } from '../sync/bootstrap'
import type { ExerciseRow, ProgramRow, Row, RowTable, SessionHeader, SetRow } from '../sync/rows'
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
}

interface MetaRecord {
  name: 'cursor' | 'seq'
  value: number
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
          for (const write of writes) {
            seq += 1
            outbox.put({
              key: rowKey(write),
              table: write.table,
              id: write.row.id,
              seq
            })
          }
          tx.objectStore(OBJECT_STORES.META).put({ name: 'seq', value: seq })
        }
      } catch (error) {
        fail(error)
      }
    })
    window.dispatchEvent(new CustomEvent('jimbro:rows-written'))
  }

  async getMeta(name: MetaRecord['name']): Promise<number> {
    const record = await this.get<MetaRecord>(OBJECT_STORES.META, name)
    return record?.value ?? 0
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
        const pending = new Map((pendingRequest.result as OutboxEntry[]).map((entry) => [entry.key, entry]))
        const seqRequest = tx.objectStore(OBJECT_STORES.META).get('seq')
        seqRequest.onsuccess = () => {
          let seq = (seqRequest.result as MetaRecord | undefined)?.value ?? 0
          const keptSets: SetRow[] = []
          for (const [key, action] of input.actions) {
            const entry = pending.get(key)
            const during = Boolean(entry && entry.seq > input.seqAtStart)
            if (action === 'keepServer') {
              if (during) continue
              const pulled = input.pulledByKey.get(key)
              if (!pulled) continue
              putRow(tx, pulled)
              if (pulled.table === 'sets') keptSets.push(pulled.row)
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
          mergeSetGroups(tx, keptSets)
          tx.objectStore(OBJECT_STORES.META).put({ name: 'seq', value: seq })
          tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: input.cursor })
        }
      }
    })
  }

  async commitPullPage(page: Array<Row & { rev: number }>, cursor: number): Promise<void> {
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
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('commitPullPage failed'))
      tx.onabort = () => reject(tx.error ?? new Error('commitPullPage aborted'))
      const outbox = tx.objectStore(OBJECT_STORES.OUTBOX)
      const pendingRequest = outbox.getAll()
      pendingRequest.onsuccess = () => {
        const pending = new Set((pendingRequest.result as OutboxEntry[]).map((entry) => entry.key))
        const sets: SetRow[] = []
        for (const entry of page) {
          const row = rowFromWire(entry)
          if (pending.has(rowKey(row))) continue
          putRow(tx, row)
          if (row.table === 'sets') sets.push(row.row)
        }
        mergeSetGroups(tx, sets)
        tx.objectStore(OBJECT_STORES.META).put({ name: 'cursor', value: cursor })
      }
    })
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

  async deleteOutboxIfUnchanged(entries: Array<{ key: string; seq: number }>): Promise<void> {
    if (entries.length === 0) return
    const db = await this.init()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([OBJECT_STORES.OUTBOX], 'readwrite')
      const store = tx.objectStore(OBJECT_STORES.OUTBOX)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('deleteOutboxIfUnchanged failed'))
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
