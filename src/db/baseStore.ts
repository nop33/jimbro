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
    await storage.create(this.storeName, item)
  }

  async update(item: T): Promise<T> {
    await storage.update(this.storeName, item)
    return item
  }

  async delete(id: string): Promise<void> {
    await storage.delete(this.storeName, id)
  }

  async count(): Promise<number> {
    return storage.count(this.storeName)
  }
}
