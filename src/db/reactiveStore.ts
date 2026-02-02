type ListenerCallback<T> = (data: T) => void

class ReactiveStore<T> {
  private listenerCallbacks: Set<ListenerCallback<T>> = new Set()
  private data: T
  private initialized = false

  constructor(initialData: T) {
    this.data = initialData
  }

  subscribe(callback: ListenerCallback<T>) {
    this.listenerCallbacks.add(callback)

    const unsubscribe = () => this.listenerCallbacks.delete(callback)

    return unsubscribe
  }

  getFromMemory(): T {
    if (!this.initialized) {
      throw new Error('Memory not initialized. Call initialize() first.')
    }
    return this.data
  }

  setToMemory(newData: T) {
    this.data = newData
    this.initialized = true
    this.notify()
  }

  protected update(updater: (currentData: T) => T) {
    this.setToMemory(updater(this.data))
  }

  protected notify() {
    this.listenerCallbacks.forEach((listenerCallback) => listenerCallback(this.data))
  }
}

export default ReactiveStore
