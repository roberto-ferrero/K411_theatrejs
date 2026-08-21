import type {
  EasingPreset,
  KeyframeAddress,
  ObjectAddress,
  PropertyAddress,
  SerializableMap,
  SerializableValue,
  TheatreBasicKeyframedTrack,
  TheatreKeyframe,
  TimelineDocument,
  TrackAddress,
} from './model'
import {cloneDocument, cloneValue} from './model'
import {encodePropertyPath, setValueAtPath, unsetValueAtPath} from './paths'
import {validateTheatreProjectState} from './validation'

export type StoreChangeKind =
  | 'commit'
  | 'preview'
  | 'undo'
  | 'redo'
  | 'replace'

export interface StoreChange {
  readonly kind: StoreChangeKind
  readonly document: TimelineDocument
  readonly revision: number
  readonly label?: string
}

export interface HistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel?: string
  readonly redoLabel?: string
}

export interface NewKeyframe {
  readonly id?: string
  readonly position: number
  readonly value: SerializableValue
  readonly handles?: [number, number, number, number]
  readonly connectedRight?: boolean
  readonly type?: 'bezier' | 'hold'
}

export interface KeyframePatch {
  readonly position?: number
  readonly value?: SerializableValue
  readonly handles?: [number, number, number, number]
  readonly connectedRight?: boolean
  readonly type?: 'bezier' | 'hold'
}

export interface TimelineTransaction {
  ensureSheet(sheetId: string, options?: {length?: number; fps?: number}): void
  ensureObject(address: ObjectAddress): void
  forgetObject(address: ObjectAddress): void
  setStaticValue(address: PropertyAddress, value: SerializableValue): void
  unsetStaticValue(address: PropertyAddress): void
  sequenceProperty(
    address: PropertyAddress,
    options?: {trackId?: string; debugName?: string},
  ): string
  unsequenceProperty(address: PropertyAddress): void
  removeTrack(address: TrackAddress): void
  addKeyframe(address: TrackAddress, keyframe: NewKeyframe): string
  updateKeyframe(address: KeyframeAddress, patch: KeyframePatch): void
  removeKeyframe(address: KeyframeAddress): void
  setInterpolation(address: KeyframeAddress, preset: EasingPreset): void
  setLength(sheetId: string, length: number): void
  setFps(sheetId: string, fps: number): void
}

export interface EditingGesture {
  readonly active: boolean
  update(callback: (transaction: TimelineTransaction) => void): void
  commit(): void
  cancel(): void
}

interface HistoryEntry {
  readonly document: TimelineDocument
  readonly label: string
}

type StoreListener = (change: StoreChange) => void

export type TimelineIdFactory = (prefix: string) => string

export interface TimelineStoreOptions {
  readonly idFactory?: TimelineIdFactory
}

export class TimelineStore {
  private documentValue: TimelineDocument
  private revisionValue = 0
  private readonly listeners = new Set<StoreListener>()
  private readonly past: HistoryEntry[] = []
  private readonly future: HistoryEntry[] = []
  private activeGesture = false
  private readonly idFactory: TimelineIdFactory

  constructor(document: TimelineDocument, options: TimelineStoreOptions = {}) {
    validateTheatreProjectState(document)
    this.documentValue = cloneDocument(document)
    this.idFactory = options.idFactory ?? createEntityId
  }

  get document(): TimelineDocument {
    return this.documentValue
  }

  get revision(): number {
    return this.revisionValue
  }

  get history(): HistoryState {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past[this.past.length - 1]?.label,
      redoLabel: this.future[this.future.length - 1]?.label,
    }
  }

  subscribe(listener: StoreListener, emitCurrent = true): () => void {
    this.listeners.add(listener)
    if (emitCurrent) {
      listener({
        kind: 'replace',
        document: this.documentValue,
        revision: this.revisionValue,
      })
    }
    return () => this.listeners.delete(listener)
  }

  transaction<Result>(
    label: string,
    callback: (transaction: TimelineTransaction) => Result,
  ): Result {
    if (this.activeGesture) {
      throw new Error('No se puede abrir una transacción durante un gesto')
    }
    const before = cloneDocument(this.documentValue)
    const draft = cloneDocument(this.documentValue)
    const result = callback(
      new TimelineTransactionImplementation(draft, this.idFactory),
    )
    validateTheatreProjectState(draft)
    if (!documentsAreEqual(before, draft)) {
      this.commitDocument(before, draft, label, 'commit')
    }
    return result
  }

  beginGesture(label: string): EditingGesture {
    if (this.activeGesture) throw new Error('Ya hay un gesto de edición activo')
    this.activeGesture = true
    const before = cloneDocument(this.documentValue)
    let preview = before
    let closed = false

    const assertOpen = (): void => {
      if (closed) throw new Error('El gesto de edición ya está cerrado')
    }
    const close = (): void => {
      assertOpen()
      closed = true
      this.activeGesture = false
    }

    return {
      get active(): boolean {
        return !closed
      },
      update: (callback) => {
        assertOpen()
        preview = cloneDocument(before)
        callback(new TimelineTransactionImplementation(preview, this.idFactory))
        validateTheatreProjectState(preview)
        this.documentValue = preview
        this.emit({
          kind: 'preview',
          document: this.documentValue,
          revision: this.revisionValue,
          label,
        })
      },
      commit: () => {
        close()
        if (documentsAreEqual(before, preview)) {
          this.documentValue = before
          return
        }
        this.commitDocument(before, preview, label, 'commit')
      },
      cancel: () => {
        close()
        this.documentValue = before
        this.emit({
          kind: 'replace',
          document: this.documentValue,
          revision: this.revisionValue,
          label,
        })
      },
    }
  }

  undo(): boolean {
    if (this.activeGesture) throw new Error('No se puede deshacer durante un gesto')
    const entry = this.past.pop()
    if (!entry) return false
    this.future.push({document: cloneDocument(this.documentValue), label: entry.label})
    this.documentValue = addRevision(
      entry.document,
      this.documentValue.revisionHistory,
      this.idFactory,
    )
    this.revisionValue += 1
    this.emit({
      kind: 'undo',
      document: this.documentValue,
      revision: this.revisionValue,
      label: entry.label,
    })
    return true
  }

  redo(): boolean {
    if (this.activeGesture) throw new Error('No se puede rehacer durante un gesto')
    const entry = this.future.pop()
    if (!entry) return false
    this.past.push({document: cloneDocument(this.documentValue), label: entry.label})
    this.documentValue = addRevision(
      entry.document,
      this.documentValue.revisionHistory,
      this.idFactory,
    )
    this.revisionValue += 1
    this.emit({
      kind: 'redo',
      document: this.documentValue,
      revision: this.revisionValue,
      label: entry.label,
    })
    return true
  }

  replace(document: TimelineDocument): void {
    if (this.activeGesture) throw new Error('No se puede reemplazar durante un gesto')
    validateTheatreProjectState(document)
    this.documentValue = cloneDocument(document)
    this.past.length = 0
    this.future.length = 0
    this.revisionValue += 1
    this.emit({
      kind: 'replace',
      document: this.documentValue,
      revision: this.revisionValue,
    })
  }

  private commitDocument(
    before: TimelineDocument,
    draft: TimelineDocument,
    label: string,
    kind: StoreChangeKind,
  ): void {
    this.past.push({document: before, label})
    this.future.length = 0
    this.documentValue = addRevision(draft, before.revisionHistory, this.idFactory)
    this.revisionValue += 1
    this.emit({kind, document: this.documentValue, revision: this.revisionValue, label})
  }

  private emit(change: StoreChange): void {
    for (const listener of this.listeners) listener(change)
  }
}

class TimelineTransactionImplementation implements TimelineTransaction {
  constructor(
    private readonly draft: TimelineDocument,
    private readonly idFactory: TimelineIdFactory,
  ) {}

  ensureSheet(
    sheetId: string,
    options: {length?: number; fps?: number} = {},
  ): void {
    if (sheetId.length === 0) throw new Error('El ID de la sheet no puede estar vacío')
    const existing = this.draft.sheetsById[sheetId]
    if (existing) {
      if (!existing.sequence) {
        existing.sequence = createSequence(options.length, options.fps)
      }
      return
    }
    this.draft.sheetsById[sheetId] = {
      staticOverrides: {byObject: {}},
      sequence: createSequence(options.length, options.fps),
    }
  }

  ensureObject(address: ObjectAddress): void {
    this.ensureSheet(address.sheetId)
    const sheet = this.draft.sheetsById[address.sheetId]
    const sequence = sheet.sequence as NonNullable<typeof sheet.sequence>
    sheet.staticOverrides.byObject[address.objectKey] ??= {}
    sequence.tracksByObject[address.objectKey] ??= {
      trackIdByPropPath: {},
      trackData: {},
    }
  }

  forgetObject(address: ObjectAddress): void {
    const sheet = this.draft.sheetsById[address.sheetId]
    if (!sheet) return
    delete sheet.staticOverrides.byObject[address.objectKey]
    if (sheet.sequence) delete sheet.sequence.tracksByObject[address.objectKey]
  }

  setStaticValue(address: PropertyAddress, value: SerializableValue): void {
    this.ensureObject(address)
    const object = this.draft.sheetsById[address.sheetId].staticOverrides.byObject[
      address.objectKey
    ] as SerializableMap
    setValueAtPath(object, address.path, cloneValue(value))
  }

  unsetStaticValue(address: PropertyAddress): void {
    const object =
      this.draft.sheetsById[address.sheetId]?.staticOverrides.byObject[
        address.objectKey
      ]
    if (object) unsetValueAtPath(object, address.path)
  }

  sequenceProperty(
    address: PropertyAddress,
    options: {trackId?: string; debugName?: string} = {},
  ): string {
    this.ensureObject(address)
    const objectTracks = this.draft.sheetsById[address.sheetId].sequence
      ?.tracksByObject[address.objectKey]
    if (!objectTracks) throw new Error('No se pudieron crear los tracks del objeto')
    const encodedPath = encodePropertyPath(address.path)
    const existing = objectTracks.trackIdByPropPath[encodedPath]
    if (existing) return existing

    const trackId = options.trackId ?? this.idFactory('track')
    if (objectTracks.trackData[trackId]) {
      throw new Error(`Track ID duplicado: ${trackId}`)
    }
    objectTracks.trackIdByPropPath[encodedPath] = trackId
    objectTracks.trackData[trackId] = {
      type: 'BasicKeyframedTrack',
      __debugName:
        options.debugName ?? `${address.objectKey}:${encodePropertyPath(address.path)}`,
      keyframes: [],
    }
    return trackId
  }

  unsequenceProperty(address: PropertyAddress): void {
    const objectTracks = this.draft.sheetsById[address.sheetId]?.sequence
      ?.tracksByObject[address.objectKey]
    if (!objectTracks) return
    const encodedPath = encodePropertyPath(address.path)
    const trackId = objectTracks.trackIdByPropPath[encodedPath]
    if (!trackId) return
    delete objectTracks.trackIdByPropPath[encodedPath]
    delete objectTracks.trackData[trackId]
  }

  removeTrack(address: TrackAddress): void {
    const objectTracks = this.draft.sheetsById[address.sheetId]?.sequence
      ?.tracksByObject[address.objectKey]
    if (!objectTracks) return
    for (const [encodedPath, trackId] of Object.entries(
      objectTracks.trackIdByPropPath,
    )) {
      if (trackId === address.trackId) delete objectTracks.trackIdByPropPath[encodedPath]
    }
    delete objectTracks.trackData[address.trackId]
  }

  addKeyframe(address: TrackAddress, keyframe: NewKeyframe): string {
    const track = getTrack(this.draft, address)
    const existing = track.keyframes.find(
      (candidate) => Math.abs(candidate.position - keyframe.position) < 1e-6,
    )
    if (existing) {
      existing.value = cloneValue(keyframe.value)
      return existing.id
    }

    const id = keyframe.id ?? this.idFactory('kf')
    if (track.keyframes.some((candidate) => candidate.id === id)) {
      throw new Error(`Keyframe ID duplicado: ${id}`)
    }
    const usesLinearDefaults =
      !keyframe.handles &&
      !keyframe.type &&
      typeof keyframe.connectedRight === 'undefined'
    const created: TheatreKeyframe = {
      id,
      position: keyframe.position,
      value: cloneValue(keyframe.value),
      handles: keyframe.handles ? [...keyframe.handles] : [1, 1, 0, 0],
      connectedRight: keyframe.connectedRight ?? true,
      type: keyframe.type ?? (usesLinearDefaults ? 'bezier' : undefined),
    }
    track.keyframes.push(created)
    sortKeyframes(track)
    if (usesLinearDefaults) {
      const index = track.keyframes.indexOf(created)
      const previous = track.keyframes[index - 1]
      const next = track.keyframes[index + 1]
      if (previous) {
        previous.type = 'bezier'
        previous.connectedRight = true
        previous.handles[2] = 0
        previous.handles[3] = 0
        created.handles[0] = 1
        created.handles[1] = 1
      }
      if (next) {
        created.type = 'bezier'
        created.connectedRight = true
        created.handles[2] = 0
        created.handles[3] = 0
        next.handles[0] = 1
        next.handles[1] = 1
      }
    }
    return id
  }

  updateKeyframe(address: KeyframeAddress, patch: KeyframePatch): void {
    const track = getTrack(this.draft, address)
    const keyframe = getKeyframe(track, address.keyframeId)
    if (typeof patch.position !== 'undefined') keyframe.position = patch.position
    if (typeof patch.value !== 'undefined') keyframe.value = cloneValue(patch.value)
    if (typeof patch.handles !== 'undefined') keyframe.handles = [...patch.handles]
    if (typeof patch.connectedRight !== 'undefined') {
      keyframe.connectedRight = patch.connectedRight
    }
    if (typeof patch.type !== 'undefined') keyframe.type = patch.type
    sortKeyframes(track)
  }

  removeKeyframe(address: KeyframeAddress): void {
    const track = getTrack(this.draft, address)
    const index = track.keyframes.findIndex(
      (keyframe) => keyframe.id === address.keyframeId,
    )
    if (index === -1) throw new Error(`Keyframe desconocido: ${address.keyframeId}`)
    track.keyframes.splice(index, 1)
  }

  setInterpolation(address: KeyframeAddress, preset: EasingPreset): void {
    const track = getTrack(this.draft, address)
    const index = track.keyframes.findIndex(
      (keyframe) => keyframe.id === address.keyframeId,
    )
    if (index === -1) throw new Error(`Keyframe desconocido: ${address.keyframeId}`)
    const left = track.keyframes[index]
    const right = track.keyframes[index + 1]
    if (!right) throw new Error('El último keyframe no tiene segmento de salida')

    if (preset === 'hold') {
      left.type = 'hold'
      left.connectedRight = true
      return
    }

    const points = easingPresetPoints[preset]
    left.type = 'bezier'
    left.connectedRight = true
    left.handles[2] = points[0]
    left.handles[3] = points[1]
    right.handles[0] = points[2]
    right.handles[1] = points[3]
  }

  setLength(sheetId: string, length: number): void {
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('La duración debe ser mayor que cero')
    }
    const sequence = this.draft.sheetsById[sheetId]?.sequence
    if (!sequence) throw new Error(`La sheet ${sheetId} no tiene sequence`)
    sequence.length = length
  }

  setFps(sheetId: string, fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new Error('Los FPS deben ser mayores que cero')
    }
    const sequence = this.draft.sheetsById[sheetId]?.sequence
    if (!sequence) throw new Error(`La sheet ${sheetId} no tiene sequence`)
    sequence.subUnitsPerUnit = fps
  }
}

export const easingPresetPoints: Record<
  Exclude<EasingPreset, 'hold'>,
  [number, number, number, number]
> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}

function getTrack(
  document: TimelineDocument,
  address: TrackAddress,
): TheatreBasicKeyframedTrack {
  const track =
    document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
      address.objectKey
    ]?.trackData[address.trackId]
  if (!track) throw new Error(`Track desconocido: ${address.trackId}`)
  return track
}

function getKeyframe(
  track: TheatreBasicKeyframedTrack,
  keyframeId: string,
): TheatreKeyframe {
  const keyframe = track.keyframes.find((candidate) => candidate.id === keyframeId)
  if (!keyframe) throw new Error(`Keyframe desconocido: ${keyframeId}`)
  return keyframe
}

function sortKeyframes(track: TheatreBasicKeyframedTrack): void {
  track.keyframes.sort((left, right) => left.position - right.position)
}

function addRevision(
  document: TimelineDocument,
  previousHistory: readonly string[],
  idFactory: TimelineIdFactory,
): TimelineDocument {
  const result = cloneDocument(document)
  result.revisionHistory = [idFactory('rev'), ...previousHistory].slice(0, 50)
  return result
}

function createSequence(
  length = 10,
  fps = 30,
): NonNullable<TimelineDocument['sheetsById'][string]['sequence']> {
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('La duración inicial debe ser mayor que cero')
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('Los FPS iniciales deben ser mayores que cero')
  }
  return {
    type: 'PositionalSequence',
    length,
    subUnitsPerUnit: fps,
    tracksByObject: {},
  }
}

export function createEntityId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}_${uuid.replace(/-/g, '').slice(0, 16)}`
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function documentsAreEqual(
  left: TimelineDocument,
  right: TimelineDocument,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
