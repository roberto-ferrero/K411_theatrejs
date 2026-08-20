type Listener<Payload> = (payload: Payload) => void

export class TypedEventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown>>>()

  on<Key extends keyof Events>(
    type: Key,
    listener: Listener<Events[Key]>,
  ): () => void {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener as Listener<unknown>)
    return () => listeners?.delete(listener as Listener<unknown>)
  }

  emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void {
    const listeners = this.listeners.get(type)
    if (!listeners) return
    for (const listener of [...listeners]) {
      try {
        listener(payload)
      } catch (error) {
        console.error(`Error en listener de ${String(type)}`, error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
