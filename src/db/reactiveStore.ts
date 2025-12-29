type ListenerCallback<T> = (data: T) => void

class ReactiveStore<T> {
  private listenerCallbacks: Set<ListenerCallback<T>> = new Set()
  private data: T

  constructor(initialData: T) {
    this.data = initialData
  }

  subscribe(callback: ListenerCallback<T>) {
    this.listenerCallbacks.add(callback)

    const unsubscribe = () => this.listenerCallbacks.delete(callback)

    return unsubscribe
  }

  get(): T {
    return this.data
  }

  protected set(newData: T) {
    this.data = newData
    this.notify()
  }

  protected update(updater: (currentData: T) => T) {
    this.set(updater(this.data))
  }

  protected notify() {
    this.listenerCallbacks.forEach((listenerCallback) => listenerCallback(this.data))
  }
}

export default ReactiveStore
