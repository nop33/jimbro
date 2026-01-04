import { OBJECT_STORES } from './constants'
import { storage } from './storage'

// Converts IDBRequest to Promise
export const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const isDbEmpty = async (): Promise<boolean> => {
  return (await storage.count(OBJECT_STORES.EXERSISES)) === 0 && (await storage.count(OBJECT_STORES.PROGRAMS)) === 0
}
