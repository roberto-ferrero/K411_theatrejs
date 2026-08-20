import {Timeline411Editor} from './editor'
import {evaluateSheet} from './evaluator'
import {TypedEventEmitter} from './events'
import type {
  EvaluatedSheet,
  SerializableMap,
  TheatreProjectState,
  TimelineDocument,
} from './model'
import {cloneDocument} from './model'
import {TimelineComposition, TimelineObject} from './objectApi'
import type {AnimationClock, PlaybackState} from './player'
import {browserAnimationClock, TimelinePlayer} from './player'
import {TimelineStore, createEntityId} from './store'
import type {
  HistoryState,
  StoreChange,
  TimelineIdFactory,
} from './store'
import {parseTheatreProjectState} from './validation'

export interface Timeline411Events {
  'document:change': StoreChange
  'document:preview': StoreChange
  'history:change': HistoryState
  'sequence:position': PlaybackState
  'sequence:play': PlaybackState
  'sequence:pause': PlaybackState
}

export interface Timeline411Options {
  readonly id?: string
  readonly clock?: AnimationClock
  readonly idFactory?: TimelineIdFactory
}

export interface CreateTimelineConfig extends Timeline411Options {
  readonly id: string
  readonly document?: unknown
  readonly state?: unknown
}

interface ObjectBinding {
  readonly sheetId: string
  readonly objectKey: string
  readonly defaults: SerializableMap
  readonly apply: (value: SerializableMap, snapshot: EvaluatedSheet) => void
}

interface PlayerEntry {
  readonly player: TimelinePlayer
  readonly unsubscribe: () => void
}

export class Timeline411 {
  readonly id: string
  readonly ready: Promise<void> = Promise.resolve()
  readonly store: TimelineStore
  readonly editor: Timeline411Editor
  private readonly events = new TypedEventEmitter<Timeline411Events>()
  private readonly bindings = new Set<ObjectBinding>()
  private readonly compositions = new Map<string, TimelineComposition>()
  private readonly objects = new Map<string, TimelineObject>()
  private readonly players = new Map<string, PlayerEntry>()
  private readonly evaluationListeners = new Map<string, Set<() => void>>()
  private readonly unsubscribeStore: () => void
  private readonly clock: AnimationClock
  private disposed = false

  constructor(input: unknown, options: Timeline411Options = {}) {
    const document = parseTheatreProjectState(input)
    this.id = options.id ?? 'Timeline 411'
    this.clock = options.clock ?? browserAnimationClock
    this.store = new TimelineStore(document, {idFactory: options.idFactory})
    this.editor = new Timeline411Editor(this)

    this.unsubscribeStore = this.store.subscribe((change) => {
      for (const {player} of this.players.values()) player.clampToDuration()
      this.events.emit(
        change.kind === 'preview' ? 'document:preview' : 'document:change',
        change,
      )
      this.events.emit('history:change', this.store.history)
      this.applyBindings()
    })
  }

  get document(): TimelineDocument {
    return this.store.document
  }

  get revision(): number {
    return this.store.revision
  }

  get player(): TimelinePlayer {
    return this.getPlayer(this.firstSheetId)
  }

  get firstSheetId(): string {
    const sheetId = Object.keys(this.document.sheetsById)[0]
    if (!sheetId) throw new Error('Timeline 411 necesita al menos una sheet')
    return sheetId
  }

  composition(id: string): TimelineComposition {
    this.assertActive()
    if (!this.document.sheetsById[id]) {
      this.store.transaction('Crear composition', (transaction) => {
        transaction.ensureSheet(id)
      })
    }
    let composition = this.compositions.get(id)
    if (!composition) {
      composition = new TimelineComposition(this, id)
      this.compositions.set(id, composition)
    }
    return composition
  }

  sheet(id: string): TimelineComposition {
    return this.composition(id)
  }

  getComposition(id: string): TimelineComposition | undefined {
    if (!this.document.sheetsById[id]) return undefined
    return this.composition(id)
  }

  getCompositions(): readonly TimelineComposition[] {
    return Object.keys(this.document.sheetsById).map((id) => this.composition(id))
  }

  getDuration(sheetId: string): number {
    return this.document.sheetsById[sheetId]?.sequence?.length ?? 0
  }

  getFps(sheetId: string): number {
    return this.document.sheetsById[sheetId]?.sequence?.subUnitsPerUnit ?? 30
  }

  getPlayer(sheetId: string): TimelinePlayer {
    this.assertActive()
    if (!this.document.sheetsById[sheetId]) {
      throw new Error(`Sheet desconocida: ${sheetId}`)
    }
    const existing = this.players.get(sheetId)
    if (existing) return existing.player

    const player = new TimelinePlayer(() => this.getDuration(sheetId), this.clock)
    let previousPlaying = player.playing
    const unsubscribe = player.subscribe((state) => {
      this.events.emit('sequence:position', state)
      if (state.playing !== previousPlaying) {
        this.events.emit(state.playing ? 'sequence:play' : 'sequence:pause', state)
        previousPlaying = state.playing
      }
      this.applyBindings(sheetId)
      this.emitEvaluation(sheetId)
    }, false)
    this.players.set(sheetId, {player, unsubscribe})
    return player
  }

  evaluate(sheetId: string, time: number): EvaluatedSheet {
    this.assertActive()
    const defaults: Record<string, SerializableMap> = {}
    const interpolators: Record<
      string,
      ReturnType<TimelineObject['getInterpolators']>
    > = {}
    for (const object of this.objects.values()) {
      if (object.composition.id !== sheetId) continue
      defaults[object.id] = object.getDefaultValues()
      interpolators[object.id] = object.getInterpolators()
    }
    for (const binding of this.bindings) {
      if (binding.sheetId !== sheetId || defaults[binding.objectKey]) continue
      defaults[binding.objectKey] = binding.defaults
    }
    return evaluateSheet(
      this.document,
      sheetId,
      time,
      defaults,
      interpolators,
    )
  }

  bindObject(
    sheetId: string,
    objectKey: string,
    defaults: SerializableMap,
    apply: (value: SerializableMap, snapshot: EvaluatedSheet) => void,
  ): () => void {
    this.assertActive()
    const binding: ObjectBinding = {sheetId, objectKey, defaults, apply}
    this.bindings.add(binding)
    this.getPlayer(sheetId)
    this.applyBinding(binding)
    return () => this.bindings.delete(binding)
  }

  subscribeEvaluation(
    sheetId: string,
    listener: () => void,
    emitCurrent = true,
  ): () => void {
    this.getPlayer(sheetId)
    let listeners = this.evaluationListeners.get(sheetId)
    if (!listeners) {
      listeners = new Set()
      this.evaluationListeners.set(sheetId, listeners)
    }
    listeners.add(listener)
    if (emitCurrent) listener()
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.evaluationListeners.delete(sheetId)
    }
  }

  registerObject(object: TimelineObject): void {
    const key = objectRegistrationKey(object.composition.id, object.id)
    const existing = this.objects.get(key)
    if (existing && existing !== object) {
      throw new Error(`El objeto ${object.id} ya está registrado`)
    }
    this.objects.set(key, object)
    this.notifyObjectConfigurationChanged(object.composition.id)
  }

  unregisterObject(object: TimelineObject): void {
    const key = objectRegistrationKey(object.composition.id, object.id)
    if (this.objects.get(key) === object) this.objects.delete(key)
    this.notifyObjectConfigurationChanged(object.composition.id)
  }

  notifyObjectConfigurationChanged(sheetId: string): void {
    this.applyBindings(sheetId)
    this.emitEvaluation(sheetId)
  }

  replaceDocument(document: TimelineDocument): void {
    this.assertActive()
    for (const {player} of this.players.values()) player.pause()
    this.store.replace(document)
  }

  on<Key extends keyof Timeline411Events>(
    type: Key,
    listener: (payload: Timeline411Events[Key]) => void,
  ): () => void {
    this.assertActive()
    return this.events.on(type, listener)
  }

  serialize(): TheatreProjectState {
    this.assertActive()
    return cloneDocument(this.document)
  }

  stringify(space = 2): string {
    return JSON.stringify(this.serialize(), null, space)
  }

  dispose(): void {
    if (this.disposed) return
    for (const {player, unsubscribe} of this.players.values()) {
      player.dispose()
      unsubscribe()
    }
    this.players.clear()
    this.unsubscribeStore()
    this.bindings.clear()
    this.compositions.clear()
    this.objects.clear()
    this.evaluationListeners.clear()
    this.events.clear()
    this.disposed = true
  }

  private applyBindings(sheetId?: string): void {
    for (const binding of this.bindings) {
      if (!sheetId || binding.sheetId === sheetId) this.applyBinding(binding)
    }
    if (!sheetId) {
      for (const id of this.evaluationListeners.keys()) this.emitEvaluation(id)
    }
  }

  private applyBinding(binding: ObjectBinding): void {
    const player = this.getPlayer(binding.sheetId)
    const snapshot = this.evaluate(binding.sheetId, player.position)
    binding.apply(snapshot.objects[binding.objectKey] ?? {}, snapshot)
  }

  private emitEvaluation(sheetId: string): void {
    const listeners = this.evaluationListeners.get(sheetId)
    if (!listeners) return
    for (const listener of [...listeners]) listener()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Timeline 411 ya está disposed')
  }
}

export function createTimeline(config: CreateTimelineConfig): Timeline411 {
  if (typeof config.document !== 'undefined' && typeof config.state !== 'undefined') {
    throw new Error('Usa document o state, pero no ambos')
  }
  const idFactory = config.idFactory ?? createEntityId
  const document =
    config.document ??
    config.state ??
    ({
      definitionVersion: '0.4.0',
      revisionHistory: [idFactory('rev')],
      sheetsById: {},
    } as TheatreProjectState)
  return new Timeline411(document, config)
}

function objectRegistrationKey(sheetId: string, objectKey: string): string {
  return JSON.stringify([sheetId, objectKey])
}
