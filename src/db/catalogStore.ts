import { STORE_FOR_TABLE } from './connection'
import { nowIso } from './nowIso'
import ReactiveStore from './reactiveStore'
import { storage } from './storage'
import type { Row } from './types'

type RowOfTable = { [R in Row as R['table']]: R['row'] }

type CatalogTable = 'exercises' | 'programs'

export type CatalogRow<K extends CatalogTable> = RowOfTable[K]

export type NewCatalogRow<K extends CatalogTable> = Omit<CatalogRow<K>, 'id' | 'isDeleted' | 'updatedAt'>

// The exercises or the programs, with the live ones kept in memory for the pages that show them.
// Every write goes through writeRows and shows in `all` before it lands.
export abstract class CatalogStore<K extends CatalogTable> {
  protected abstract readonly table: K

  // Fills in missing fields and upgrades older shapes.
  protected abstract normalize(row: CatalogRow<K>): CatalogRow<K>

  protected sort(rows: Array<CatalogRow<K>>): Array<CatalogRow<K>> {
    return rows
  }

  private readonly live = new ReactiveStore<Array<CatalogRow<K>>>([])

  // The live rows as of the last load(), with this tab's writes applied since.
  get all(): Array<CatalogRow<K>> {
    return this.live.get()
  }

  find(id: string): CatalogRow<K> | undefined {
    return this.live.get().find((row) => row.id === id)
  }

  subscribe(callback: (rows: Array<CatalogRow<K>>) => void): () => void {
    return this.live.subscribe(callback)
  }

  // Reads the live rows into `all` and resolves to them.
  async load(): Promise<Array<CatalogRow<K>>> {
    const stored = await storage.getAll<CatalogRow<K>>(STORE_FOR_TABLE[this.table])
    const rows = this.sort(stored.filter((row) => !row.isDeleted))
    this.live.set(rows)
    return rows
  }

  // Reads one row from IndexedDB, deleted or not.
  async getById(id: string): Promise<CatalogRow<K> | undefined> {
    return storage.get<CatalogRow<K>>(STORE_FOR_TABLE[this.table], id)
  }

  // A failed write takes the row out of `all` again.
  async create(fields: NewCatalogRow<K>): Promise<CatalogRow<K>> {
    const row = this.normalize({
      ...fields,
      id: crypto.randomUUID(),
      isDeleted: false,
      updatedAt: nowIso()
    } as CatalogRow<K>)
    this.live.update((rows) => [...rows, row])
    try {
      await this.write([row])
    } catch (error) {
      this.live.update((rows) => rows.filter((candidate) => candidate.id !== row.id))
      throw error
    }
    return row
  }

  // A failed write reloads `all` from IndexedDB.
  async update(row: CatalogRow<K>): Promise<CatalogRow<K>> {
    const next = this.normalize({ ...row, updatedAt: nowIso() })
    this.live.update((rows) =>
      next.isDeleted
        ? rows.filter((candidate) => candidate.id !== next.id)
        : rows.map((candidate) => (candidate.id === next.id ? next : candidate))
    )
    try {
      await this.write([next])
    } catch (error) {
      await this.load()
      throw error
    }
    return next
  }

  // Soft-deletes a row of `all`.
  async remove(id: string): Promise<void> {
    const row = this.find(id)
    if (!row) throw new Error(`No ${this.table} row with id ${id}.`)
    await this.update({ ...row, isDeleted: true })
  }

  protected async write(rows: Array<CatalogRow<K>>): Promise<void> {
    await storage.writeRows(rows.map((row) => ({ table: this.table, row }) as Row))
  }
}
