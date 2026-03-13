type EventMap = Record<string, unknown>

type EmitArgs<T, K extends keyof T> = T[K] extends void ? [] : [data: T[K]]

class EventEmitter<T extends EventMap = EventMap> extends EventTarget {
  emit<K extends keyof T>(event: K, ...args: EmitArgs<T, K>) {
    this.dispatchEvent(new CustomEvent(event as string, { detail: args[0] }))
  }

  on<K extends keyof T>(event: K, callback: (event: CustomEvent<T[K]>) => void) {
    this.addEventListener(event as string, callback as EventListener)
  }

  off<K extends keyof T>(event: K, callback: (event: CustomEvent<T[K]>) => void) {
    this.removeEventListener(event as string, callback as EventListener)
  }
}

export default EventEmitter
