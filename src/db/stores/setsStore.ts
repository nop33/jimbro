import type { SetRow } from '../../sync/rows'
import { OBJECT_STORES } from '../constants'
import { storage } from '../storage'

export class SetsStore {
  private storeName = OBJECT_STORES.SETS

  async getAll(): Promise<Array<SetRow>> {
    return storage.getAll<SetRow>(this.storeName)
  }

  async getBySession(sessionId: string): Promise<Array<SetRow>> {
    return storage.getAllByIndex<SetRow>(this.storeName, 'sessionId', sessionId)
  }
}

export const setsStore = new SetsStore()
