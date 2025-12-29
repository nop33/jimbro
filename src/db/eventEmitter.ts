type EventMap = Record<string, any>

class EventEmitter<T extends EventMap = EventMap> extends EventTarget {
  emit<K extends keyof T>(event: K, data: T[K]) {
    this.dispatchEvent(new CustomEvent(event as string, { detail: data }))
  }

  on<K extends keyof T>(event: K, callback: (event: CustomEvent<T[K]>) => void) {
    this.addEventListener(event as string, callback as EventListener)
  }

  off<K extends keyof T>(event: K, callback: (event: CustomEvent<T[K]>) => void) {
    this.removeEventListener(event as string, callback as EventListener)
  }
}

export default EventEmitter
