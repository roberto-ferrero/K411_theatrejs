import {evaluateSheet} from './evaluator'
import {TypedEventEmitter} from './events'
import type {
  EvaluatedSheet,
  SerializableMap,
  TheatreProjectState,
  TimelineDocument,
} from './model'
import {cloneDocument} from './model'
import {TimelinePlayer} from './player'
import type {PlaybackState} from './player'
import {TimelineStore} from './store'
import type {HistoryState, StoreChange} from './store'
import {parseTheatreProjectState} from './validation'

export interface Timeline411Events {
  'document:change': StoreChange
  'document:preview': StoreChange
  'history:change': HistoryState
  'sequence:position': PlaybackState
  'sequence:play': PlaybackState
  'sequence:pause': PlaybackState
}

interface ObjectBinding {
  readonly sheetId: string
  readonly objectKey: string
  readonly defaults: SerializableMap
  readonly apply: (value: SerializableMap, snapshot: EvaluatedSheet) => void
}

export class Timeline411 {
  readonly store: TimelineStore
  readonly player: TimelinePlayer
  private readonly events = new TypedEventEmitter<Timeline411Events>()
  private readonly bindings = new Set<ObjectBinding>()
  private readonly unsubscribeStore: () => void
  private readonly unsubscribePlayer: () => void

  constructor(input: unknown) {
    const document = parseTheatreProjectState(input)
    this.store = new TimelineStore(document)
    this.player = new TimelinePlayer(() => this.getDuration(this.firstSheetId))

    this.unsubscribeStore = this.store.subscribe((change) => {
      this.player.clampToDuration()
      this.events.emit(
        change.kind === 'preview' ? 'document:preview' : 'document:change',
        change,
      )
      this.events.emit('history:change', this.store.history)
      this.applyBindings()
    })

    let previousPlaying = this.player.playing
    this.unsubscribePlayer = this.player.subscribe((state) => {
      this.events.emit('sequence:position', state)
      if (state.playing !== previousPlaying) {
        this.events.emit(state.playing ? 'sequence:play' : 'sequence:pause', state)
        previousPlaying = state.playing
      }
      this.applyBindings()
    })
  }

  get document(): TimelineDocument {
    return this.store.document
  }

  get firstSheetId(): string {
    const sheetId = Object.keys(this.document.sheetsById)[0]
    if (!sheetId) throw new Error('Timeline 411 necesita al menos una sheet')
    return sheetId
  }

  getDuration(sheetId: string): number {
    return this.document.sheetsById[sheetId]?.sequence?.length ?? 0
  }

  getFps(sheetId: string): number {
    return this.document.sheetsById[sheetId]?.sequence?.subUnitsPerUnit ?? 30
  }

  evaluate(sheetId: string, time: number): EvaluatedSheet {
    const defaults: Record<string, SerializableMap> = {}
    for (const binding of this.bindings) {
      if (binding.sheetId === sheetId) defaults[binding.objectKey] = binding.defaults
    }
    return evaluateSheet(this.document, sheetId, time, defaults)
  }

  bindObject(
    sheetId: string,
    objectKey: string,
    defaults: SerializableMap,
    apply: (value: SerializableMap, snapshot: EvaluatedSheet) => void,
  ): () => void {
    const binding: ObjectBinding = {sheetId, objectKey, defaults, apply}
    this.bindings.add(binding)
    this.applyBinding(binding)
    return () => this.bindings.delete(binding)
  }

  on<Key extends keyof Timeline411Events>(
    type: Key,
    listener: (payload: Timeline411Events[Key]) => void,
  ): () => void {
    return this.events.on(type, listener)
  }

  serialize(): TheatreProjectState {
    return cloneDocument(this.document)
  }

  stringify(space = 2): string {
    return JSON.stringify(this.serialize(), null, space)
  }

  dispose(): void {
    this.player.dispose()
    this.unsubscribePlayer()
    this.unsubscribeStore()
    this.bindings.clear()
    this.events.clear()
  }

  private applyBindings(): void {
    for (const binding of this.bindings) this.applyBinding(binding)
  }

  private applyBinding(binding: ObjectBinding): void {
    const snapshot = this.evaluate(binding.sheetId, this.player.position)
    binding.apply(snapshot.objects[binding.objectKey] ?? {}, snapshot)
  }
}
