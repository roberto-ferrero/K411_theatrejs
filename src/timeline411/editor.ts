import type {
  EasingPreset,
  KeyframeAddress,
  ObjectAddress,
  PropertyAddress,
  SerializableMap,
  SerializableValue,
} from './model'
import {decodePropertyPath, encodePropertyPath, getValueAtPath} from './paths'
import {snapToFrame} from './projection'
import type {TimelineTransaction as StoreTransaction} from './store'
import type {KeyframePatch, NewKeyframe} from './store'
import type {Timeline411} from './timeline'
import {
  isTimelinePropertyRef,
  TimelineKeyframe,
  TimelineObject,
  TimelinePropertyRef,
  TimelineTrack,
} from './objectApi'

export interface EditorTransactionOptions {
  readonly label?: string
}

export interface AddKeyframeAtOptions<Value = unknown> {
  readonly position: number
  readonly value?: Value
}

export interface RemoveKeyframeOptions {
  readonly unsequenceIfEmpty?: boolean
}

export type TimelinePropertyTarget<Value = unknown> =
  | TimelinePropertyRef<Value>
  | PropertyAddress

export class TimelineHistory {
  constructor(private readonly timeline: Timeline411) {}

  get canUndo(): boolean {
    return this.timeline.store.history.canUndo
  }

  get canRedo(): boolean {
    return this.timeline.store.history.canRedo
  }

  get undoLabel(): string | undefined {
    return this.timeline.store.history.undoLabel
  }

  get redoLabel(): string | undefined {
    return this.timeline.store.history.redoLabel
  }

  undo(): boolean {
    return this.timeline.store.undo()
  }

  redo(): boolean {
    return this.timeline.store.redo()
  }
}

export class Timeline411Editor {
  readonly history: TimelineHistory

  constructor(private readonly timeline: Timeline411) {
    this.history = new TimelineHistory(timeline)
  }

  transaction<Result>(
    callback: (transaction: TimelineEditorTransaction) => Result,
    options: EditorTransactionOptions = {},
  ): Result {
    const afterCommit: Array<() => void> = []
    const result = this.timeline.store.transaction(
      options.label ?? 'Editar timeline',
      (storeTransaction) =>
        callback(
          new TimelineEditorTransaction(
            this.timeline,
            storeTransaction,
            afterCommit,
          ),
        ),
    )
    for (const effect of afterCommit) effect()
    return result
  }

  getTrackFor<Value>(
    property: TimelinePropertyRef<Value>,
  ): TimelineTrack<Value> | undefined {
    assertPropertyBelongsToTimeline(this.timeline, property)
    return property.object.composition.getTrackFor(property) as unknown as
      | TimelineTrack<Value>
      | undefined
  }

  forgetObject(
    object: TimelineObject | ObjectAddress,
    options: EditorTransactionOptions = {},
  ): void {
    this.transaction(
      (transaction) => transaction.forgetObject(object),
      {label: options.label ?? 'Eliminar objeto'},
    )
  }
}

export class TimelineEditorTransaction {
  private readonly stagedTrackIds = new Map<string, string>()
  private readonly stagedUnsequenced = new Set<string>()
  private readonly stagedValues = new Map<string, SerializableValue>()
  private readonly stagedKeyframeIds = new Map<string, string>()

  constructor(
    private readonly timeline: Timeline411,
    private readonly transaction: StoreTransaction,
    private readonly afterCommit: Array<() => void>,
  ) {}

  set<Value>(property: TimelinePropertyRef<Value>, value: Value): void {
    this.forEachLeafValue(property, value, (leaf, leafValue) => {
      const key = propertyKey(leaf)
      const track = this.getTrackFor(leaf)
      if (track) {
        const position = snappedPosition(leaf)
        const id = this.transaction.addKeyframe(track.address, {
          position,
          value: leafValue,
        })
        this.stagedKeyframeIds.set(keyframeKey(key, position), id)
      } else {
        this.transaction.setStaticValue(leaf.address, leafValue)
      }
      this.stagedValues.set(key, leafValue)
    })
  }

  unset(property: TimelinePropertyRef): void {
    this.forEachLeaf(property, (leaf) => {
      const key = propertyKey(leaf)
      const track = this.getTrackFor(leaf)
      if (!track) {
        this.transaction.unsetStaticValue(leaf.address)
        this.stagedValues.delete(key)
        return
      }
      const position = snappedPosition(leaf)
      const stagedId = this.stagedKeyframeIds.get(keyframeKey(key, position))
      const existingId = this.stagedTrackIds.has(key)
        ? undefined
        : track.snapshot.keyframes.find(
            (candidate) => Math.abs(candidate.position - position) < 1e-6,
          )?.id
      const keyframeId = stagedId ?? existingId
      if (keyframeId) {
        this.transaction.removeKeyframe({
          ...track.address,
          keyframeId,
        })
        this.stagedKeyframeIds.delete(keyframeKey(key, position))
      }
    })
  }

  sequence<Value>(property: TimelinePropertyRef<Value>): TimelineTrack<Value> {
    assertPrimitiveProperty(property)
    assertPropertyBelongsToTimeline(this.timeline, property)
    const key = propertyKey(property)
    const existing = this.getTrackFor(property)
    if (existing) return existing as unknown as TimelineTrack<Value>

    const value =
      this.stagedValues.get(key) ??
      sanitizePropertyValue(property, property.get())
    const trackId = this.transaction.sequenceProperty(property.address)
    const position = snappedPosition(property)
    const keyframeId = this.transaction.addKeyframe(
      {
        sheetId: property.object.composition.id,
        objectKey: property.object.id,
        trackId,
      },
      {position, value},
    )
    this.stagedTrackIds.set(key, trackId)
    this.stagedUnsequenced.delete(key)
    this.stagedKeyframeIds.set(keyframeKey(key, position), keyframeId)
    return property.object.composition.getOrCreateTrack(
      property.object.id,
      trackId,
      property.path,
    ) as unknown as TimelineTrack<Value>
  }

  unsequence(property: TimelinePropertyRef): void {
    this.forEachLeaf(property, (leaf) => {
      const key = propertyKey(leaf)
      if (!this.getTrackFor(leaf)) return
      const currentValue =
        this.stagedValues.get(key) ?? sanitizePropertyValue(leaf, leaf.get())
      this.transaction.unsequenceProperty(leaf.address)
      this.transaction.setStaticValue(leaf.address, currentValue)
      this.stagedTrackIds.delete(key)
      this.stagedUnsequenced.add(key)
      this.stagedValues.set(key, currentValue)
    })
  }

  forgetObject(object: TimelineObject | ObjectAddress): void {
    if (
      object instanceof TimelineObject &&
      object.composition.timeline !== this.timeline
    ) {
      throw new Error('El objeto pertenece a otro timeline')
    }
    const address = object instanceof TimelineObject ? object.address : object
    this.transaction.forgetObject(address)
    this.afterCommit.push(() => {
      this.timeline.getComposition(address.sheetId)?.detachObject(address.objectKey)
    })
  }

  addKeyframe<Value>(
    track: TimelineTrack<Value>,
    keyframe: NewKeyframe,
  ): TimelineKeyframe<Value> {
    assertTrackBelongsToTimeline(this.timeline, track)
    const id = this.transaction.addKeyframe(track.address, keyframe)
    return track.getOrCreateKeyframeHandle(id)
  }

  addKeyframeAt<Value>(
    property: TimelinePropertyTarget<Value>,
    options: AddKeyframeAtOptions<Value>,
  ): KeyframeAddress {
    const propertyRef = isTimelinePropertyRef(property) ? property : undefined
    if (propertyRef) {
      assertPrimitiveProperty(propertyRef)
      assertPropertyBelongsToTimeline(this.timeline, propertyRef)
    }
    const address: PropertyAddress = propertyRef
      ? propertyRef.address
      : (property as PropertyAddress)
    assertPropertyAddressBelongsToTimeline(this.timeline, address)
    const position = snapAndValidatePosition(
      this.timeline,
      address.sheetId,
      options.position,
    )
    const value = resolveKeyframeValue(
      this.timeline,
      propertyRef,
      address,
      position,
      options.value,
    )
    const key = propertyAddressKey(address)
    let trackId = this.getTrackIdForAddress(address)
    if (!trackId) {
      trackId = this.transaction.sequenceProperty(address)
      this.stagedTrackIds.set(key, trackId)
      this.stagedUnsequenced.delete(key)
    }
    const keyframeId = this.transaction.addKeyframe(
      {sheetId: address.sheetId, objectKey: address.objectKey, trackId},
      {position, value},
    )
    this.stagedValues.set(key, value)
    this.stagedKeyframeIds.set(keyframeKey(key, position), keyframeId)
    return {...address, trackId, keyframeId}
  }

  updateKeyframe(
    keyframe: TimelineKeyframe | KeyframeAddress,
    patch: KeyframePatch,
  ): void {
    if (keyframe instanceof TimelineKeyframe) {
      assertTrackBelongsToTimeline(this.timeline, keyframe.track)
    }
    const address =
      keyframe instanceof TimelineKeyframe ? keyframe.address : keyframe
    this.transaction.updateKeyframe(address, patch)
  }

  removeKeyframe(
    keyframe: TimelineKeyframe | KeyframeAddress,
    options: RemoveKeyframeOptions = {},
  ): void {
    if (keyframe instanceof TimelineKeyframe) {
      assertTrackBelongsToTimeline(this.timeline, keyframe.track)
    }
    const address =
      keyframe instanceof TimelineKeyframe ? keyframe.address : keyframe
    this.removeKeyframeByAddress(address, options)
  }

  removeKeyframeAt(
    property: TimelinePropertyTarget,
    position: number,
    options: RemoveKeyframeOptions = {},
  ): KeyframeAddress | undefined {
    const propertyRef = isTimelinePropertyRef(property) ? property : undefined
    if (propertyRef) {
      assertPrimitiveProperty(propertyRef)
      assertPropertyBelongsToTimeline(this.timeline, propertyRef)
    }
    const address: PropertyAddress = propertyRef
      ? propertyRef.address
      : (property as PropertyAddress)
    assertPropertyAddressBelongsToTimeline(this.timeline, address)
    const snapped = snapAndValidatePosition(
      this.timeline,
      address.sheetId,
      position,
    )
    const trackId = this.getTrackIdForAddress(address)
    if (!trackId) return undefined
    const track = getTrackData(this.timeline, {...address, trackId})
    const keyframe = track?.keyframes.find(
      (candidate) => Math.abs(candidate.position - snapped) < 1e-6,
    )
    if (!keyframe) return undefined
    const keyframeAddress = {...address, trackId, keyframeId: keyframe.id}
    this.removeKeyframeByAddress(keyframeAddress, options)
    return keyframeAddress
  }

  setInterpolation(
    keyframe: TimelineKeyframe | KeyframeAddress,
    preset: EasingPreset,
  ): void {
    if (keyframe instanceof TimelineKeyframe) {
      assertTrackBelongsToTimeline(this.timeline, keyframe.track)
    }
    const address =
      keyframe instanceof TimelineKeyframe ? keyframe.address : keyframe
    this.transaction.setInterpolation(address, preset)
  }

  setDuration(sheetId: string, duration: number): void {
    this.transaction.setLength(sheetId, duration)
  }

  setFps(sheetId: string, fps: number): void {
    this.transaction.setFps(sheetId, fps)
  }

  private forEachLeaf(
    property: TimelinePropertyRef,
    callback: (leaf: TimelinePropertyRef) => void,
  ): void {
    assertPropertyBelongsToTimeline(this.timeline, property)
    for (const leaf of property.getLeafRefs()) callback(leaf)
  }

  private forEachLeafValue<Value>(
    property: TimelinePropertyRef<Value>,
    value: Value,
    callback: (leaf: TimelinePropertyRef, value: SerializableValue) => void,
  ): void {
    assertPropertyBelongsToTimeline(this.timeline, property)
    const sanitized = property.config.sanitize(value)
    if (typeof sanitized === 'undefined') {
      throw new Error(`Valor inválido para ${property.path.join('.')}`)
    }
    const root =
      property.config.type === 'compound'
        ? (sanitized as SerializableMap)
        : undefined
    for (const leaf of property.getLeafRefs()) {
      const relativePath = leaf.path.slice(property.path.length)
      const raw = root ? getValueAtPath(root, relativePath) : sanitized
      callback(leaf, sanitizePropertyValue(leaf, raw))
    }
  }

  private getTrackFor(property: TimelinePropertyRef): TimelineTrack | undefined {
    const key = propertyKey(property)
    if (this.stagedUnsequenced.has(key)) return undefined
    const stagedTrackId = this.stagedTrackIds.get(key)
    if (stagedTrackId) {
      return property.object.composition.getOrCreateTrack(
        property.object.id,
        stagedTrackId,
        property.path,
      )
    }
    return property.object.composition.getTrackFor(property)
  }

  private getTrackIdForAddress(address: PropertyAddress): string | undefined {
    const key = propertyAddressKey(address)
    if (this.stagedUnsequenced.has(key)) return undefined
    return (
      this.stagedTrackIds.get(key) ??
      this.timeline.document.sheetsById[address.sheetId]?.sequence
        ?.tracksByObject[address.objectKey]?.trackIdByPropPath[
          encodePropertyPath(address.path)
        ]
    )
  }

  private removeKeyframeByAddress(
    address: KeyframeAddress,
    options: RemoveKeyframeOptions,
  ): void {
    const track = getTrackData(this.timeline, address)
    const keyframe = track?.keyframes.find(
      (candidate) => candidate.id === address.keyframeId,
    )
    if (!track || !keyframe) {
      throw new Error(`Keyframe desconocido: ${address.keyframeId}`)
    }
    if (track.keyframes.length > 1 || options.unsequenceIfEmpty === false) {
      this.transaction.removeKeyframe(address)
      return
    }

    const propertyAddress = findPropertyAddressForTrack(this.timeline, address)
    if (!propertyAddress) {
      this.transaction.removeKeyframe(address)
      return
    }
    const evaluated = getValueAtPath(
      this.timeline.evaluate(
        propertyAddress.sheetId,
        this.timeline.getPlayer(propertyAddress.sheetId).position,
      ).objects[propertyAddress.objectKey] ?? {},
      propertyAddress.path,
    )
    const staticValue =
      typeof evaluated === 'undefined' ? keyframe.value : evaluated
    this.transaction.unsequenceProperty(propertyAddress)
    this.transaction.setStaticValue(propertyAddress, staticValue)
    const key = propertyAddressKey(propertyAddress)
    this.stagedTrackIds.delete(key)
    this.stagedUnsequenced.add(key)
    this.stagedValues.set(key, staticValue)
    this.stagedKeyframeIds.delete(keyframeKey(key, keyframe.position))
  }
}

function sanitizePropertyValue(
  property: TimelinePropertyRef,
  value: unknown,
): SerializableValue {
  const sanitized = property.config.sanitize(value)
  if (typeof sanitized === 'undefined') {
    throw new Error(`Valor inválido para ${property.path.join('.')}`)
  }
  return sanitized as SerializableValue
}

function snappedPosition(property: TimelinePropertyRef): number {
  const sequence = property.object.composition.sequence
  return snapToFrame(sequence.position, sequence.fps)
}

function assertPrimitiveProperty(property: TimelinePropertyRef): void {
  if (property.config.type === 'compound') {
    throw new Error('sequence() necesita una referencia a una prop primitiva')
  }
}

function assertPropertyBelongsToTimeline(
  timeline: Timeline411,
  property: TimelinePropertyRef<unknown>,
): void {
  if (
    !isTimelinePropertyRef(property) ||
    property.object.composition.timeline !== timeline
  ) {
    throw new Error('La referencia de propiedad pertenece a otro timeline')
  }
}

function assertPropertyAddressBelongsToTimeline(
  timeline: Timeline411,
  address: PropertyAddress,
): void {
  if (
    !timeline.document.sheetsById[address.sheetId] ||
    address.objectKey.length === 0 ||
    address.path.length === 0
  ) {
    throw new Error('La dirección de propiedad no pertenece al timeline')
  }
}

function assertTrackBelongsToTimeline(
  timeline: Timeline411,
  track: TimelineTrack<unknown>,
): void {
  if (track.composition.timeline !== timeline) {
    throw new Error('El track pertenece a otro timeline')
  }
}

function propertyKey(property: TimelinePropertyRef): string {
  return propertyAddressKey(property.address)
}

function propertyAddressKey(address: PropertyAddress): string {
  return JSON.stringify([address.sheetId, address.objectKey, address.path])
}

function keyframeKey(property: string, position: number): string {
  return `${property}@${position}`
}

function snapAndValidatePosition(
  timeline: Timeline411,
  sheetId: string,
  requestedPosition: number,
): number {
  const duration = timeline.getDuration(sheetId)
  if (
    !Number.isFinite(requestedPosition) ||
    requestedPosition < 0 ||
    requestedPosition > duration
  ) {
    throw new Error(`El tiempo debe estar entre 0 y ${duration} segundos`)
  }
  const position = snapToFrame(requestedPosition, timeline.getFps(sheetId))
  if (position < 0 || position > duration) {
    throw new Error('El frame más cercano queda fuera de la duración')
  }
  return position
}

function resolveKeyframeValue<Value>(
  timeline: Timeline411,
  property: TimelinePropertyRef<Value> | undefined,
  address: PropertyAddress,
  position: number,
  requestedValue: Value | undefined,
): SerializableValue {
  const raw =
    typeof requestedValue === 'undefined'
      ? getValueAtPath(
          timeline.evaluate(address.sheetId, position).objects[
            address.objectKey
          ] ?? {},
          address.path,
        )
      : requestedValue
  if (typeof raw === 'undefined') {
    throw new Error(`No hay un valor disponible para ${address.path.join('.')}`)
  }
  return property
    ? sanitizePropertyValue(property, raw)
    : (raw as SerializableValue)
}

function getTrackData(
  timeline: Timeline411,
  address: {sheetId: string; objectKey: string; trackId: string},
) {
  return timeline.document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
    address.objectKey
  ]?.trackData[address.trackId]
}

function findPropertyAddressForTrack(
  timeline: Timeline411,
  address: {sheetId: string; objectKey: string; trackId: string},
): PropertyAddress | undefined {
  const mappings =
    timeline.document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
      address.objectKey
    ]?.trackIdByPropPath
  if (!mappings) return undefined
  for (const [encodedPath, trackId] of Object.entries(mappings)) {
    if (trackId === address.trackId) {
      return {
        sheetId: address.sheetId,
        objectKey: address.objectKey,
        path: decodePropertyPath(encodedPath),
      }
    }
  }
  return undefined
}
