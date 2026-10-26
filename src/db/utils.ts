import { OBJECT_STORES } from './constants'
import { storage } from './storage'

// Whether this device holds no exercise and no program yet, as on a new phone.
export const isDbEmpty = async (): Promise<boolean> =>
  (await storage.count(OBJECT_STORES.EXERCISES)) === 0 && (await storage.count(OBJECT_STORES.PROGRAMS)) === 0
