// Converts IDBRequest to Promise
export const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Resolves once the transaction commits, and rejects when it fails or aborts, naming what it was doing.
export const transactionDone = (tx: IDBTransaction, doing: string): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error(`${doing} failed`))
    tx.onabort = () => reject(tx.error ?? new Error(`${doing} aborted`))
  })
