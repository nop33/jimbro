import type { Row } from '../sync/rows'
import { storage } from './storage'

export interface Entity {
  id: string
}

export abstract class BaseStore<T extends Entity> {
  protected abstract readonly storeName: string

  async getAll(): Promise<Array<T>> {
    return storage.getAll<T>(this.storeName)
  }

  async getById(id: string): Promise<T | undefined> {
    return storage.get<T>(this.storeName, id)
  }

  async create(item: T): Promise<void> {
    await storage.writeRows([{ table: this.storeName, row: item } as unknown as Row])
  }

  async update(item: T): Promise<T> {
    await storage.writeRows([{ table: this.storeName, row: item } as unknown as Row])
    return item
  }
}
