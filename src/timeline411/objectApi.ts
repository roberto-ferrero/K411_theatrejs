import {evaluateTrack} from './evaluator'
import type {
  KeyframeAddress,
  PropertyAddress,
  PropertyPath,
  SerializableMap,
  SerializableValue,
  TheatreKeyframe,
  TrackAddress,
} from './model'
import {cloneValue} from './model'
import {decodePropertyPath, encodePropertyPath, getValueAtPath} from './paths'
import type {PlaybackState} from './player'
import type {
  CompoundPropTypeConfig,
  NormalizedPropSchema,
  PropValue,
  PropsValue,
  TimelinePropTypeConfig,
  TimelineShorthandProp,
  TimelineShorthandSchema,
} from './propTypes'
import {
  defaultValueFromSchema,
  interpolatorsFromSchema,
  normalizePropSchema,
  sanitizeValueWithSchema,
  schemasAreCompatible,
} from './propTypes'
import type {Timeline411} from './timeline'

export interface ValueSubscriptionOptions {
  readonly emitCurrent?: boolean
}

export interface TimelineObjectBindingAdapter<Value> {
  apply(value: Value): void
}

export type PropertyRefFor<Prop> = Prop extends CompoundPropTypeConfig<infer Props>
  ? TimelinePropertyRef<PropValue<Prop>> & PropertyRefs<Props>
  : Prop extends TimelinePropTypeConfig
    ? TimelinePropertyRef<PropValue<Prop>>
    : Prop extends TimelineShorthandSchema
      ? TimelinePropertyRef<PropsValue<Prop>> & PropertyRefs<Prop>
      : TimelinePropertyRef<PropValue<Prop>>

export type PropertyRefs<Props> = {
  readonly [Key in keyof Props]: PropertyRefFor<Props[Key]>
}

const propertyRefMarker = Symbol('Timeline411PropertyRef')

export class TimelinePropertyRef<Value = unknown> {
  readonly [propertyRefMarker] = true

  constructor(
    readonly object: TimelineObject<TimelineShorthandSchema>,
    readonly path: PropertyPath,
    readonly config: TimelinePropTypeConfig,
  ) {}

  get address(): PropertyAddress {
    return {
      sheetId: this.object.composition.id,
      objectKey: this.object.id,
      path: this.path,
    }
  }

  get(): Value {
    const raw = getValueAtPath(this.object.valueMap, this.path)
    const sanitized = this.config.sanitize(raw)
    return cloneValue(
      (typeof sanitized === 'undefined' ? this.config.default : sanitized) as
        | SerializableValue
        | undefined,
    ) as unknown as Value
  }

  onChange(
    listener: (value: Value) => void,
    options: ValueSubscriptionOptions = {},
  ): () => void {
    let initialized = false
    let previous = ''
    const emit = (): void => {
      const value = this.get()
      const serialized = stableValue(value)
      if (initialized && serialized === previous) return
      initialized = true
      previous = serialized
      listener(value)
    }
    if (options.emitCurrent !== false) emit()
    else {
      initialized = true
      previous = stableValue(this.get())
    }
    return this.object.composition.timeline.subscribeEvaluation(
      this.object.composition.id,
      emit,
      false,
    )
  }

  getLeafRefs(): readonly TimelinePropertyRef[] {
    if (this.config.type !== 'compound') {
      return [this as unknown as TimelinePropertyRef]
    }
    const refs: TimelinePropertyRef[] = []
    for (const child of Object.values(this as unknown as Record<string, unknown>)) {
      if (isTimelinePropertyRef(child)) refs.push(...child.getLeafRefs())
    }
    return [...new Set(refs)]
  }
}

export function isTimelinePropertyRef(
  value: unknown,
): value is TimelinePropertyRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<TimelinePropertyRef>)[propertyRefMarker] === true
  )
}

export interface TimelineObjectOptions {
  readonly reconfigure?: boolean
}

export class TimelineObject<
  Props extends TimelineShorthandSchema = TimelineShorthandSchema,
> {
  readonly props: PropertyRefs<Props>
  private initialDefaults: SerializableMap

  constructor(
    readonly composition: TimelineComposition,
    readonly id: string,
    readonly schema: NormalizedPropSchema,
  ) {
    this.initialDefaults = defaultValueFromSchema(schema)
    this.props = buildPropertyRefs(this, schema) as PropertyRefs<Props>
  }

  get address(): {sheetId: string; objectKey: string} {
    return {sheetId: this.composition.id, objectKey: this.id}
  }

  get value(): PropsValue<Props> {
    return this.valueMap as PropsValue<Props>
  }

  get valueMap(): SerializableMap {
    const evaluated = this.composition.timeline.evaluate(
      this.composition.id,
      this.composition.sequence.position,
    ).objects[this.id]
    return sanitizeValueWithSchema(this.schema, evaluated)
  }

  set initialValue(value: Partial<PropsValue<Props>>) {
    this.initialDefaults = sanitizeValueWithSchema(this.schema, value)
    this.composition.timeline.notifyObjectConfigurationChanged(this.composition.id)
  }

  getDefaultValues(): SerializableMap {
    return cloneValue(this.initialDefaults) as SerializableMap
  }

  getInterpolators(): ReturnType<typeof interpolatorsFromSchema> {
    return interpolatorsFromSchema(this.schema)
  }

  onValuesChange(
    listener: (values: PropsValue<Props>) => void,
    options: ValueSubscriptionOptions = {},
  ): () => void {
    let initialized = false
    let previous = ''
    const emit = (): void => {
      const value = this.value
      const serialized = stableValue(value)
      if (initialized && previous === serialized) return
      initialized = true
      previous = serialized
      listener(value)
    }
    if (options.emitCurrent !== false) emit()
    else {
      initialized = true
      previous = stableValue(this.value)
    }
    return this.composition.timeline.subscribeEvaluation(
      this.composition.id,
      emit,
      false,
    )
  }

  bind(
    adapter:
      | TimelineObjectBindingAdapter<PropsValue<Props>>
      | ((value: PropsValue<Props>) => void),
  ): () => void {
    const apply = (
      typeof adapter === 'function' ? adapter : adapter.apply.bind(adapter)
    ) as (value: PropsValue<Props>) => void
    return this.onValuesChange(apply)
  }

  detach(): void {
    this.composition.detachObject(this.id)
  }
}

export interface TrackSnapshot {
  readonly id: string
  readonly objectKey: string
  readonly propertyPath: PropertyPath
  readonly keyframes: readonly TheatreKeyframe[]
}

export class TimelineTrack<Value = unknown> {
  private readonly keyframes = new Map<string, TimelineKeyframe<Value>>()

  constructor(
    readonly composition: TimelineComposition,
    readonly objectKey: string,
    readonly id: string,
    readonly propertyPath: PropertyPath,
  ) {}

  get address(): TrackAddress {
    return {
      sheetId: this.composition.id,
      objectKey: this.objectKey,
      trackId: this.id,
    }
  }

  get property(): TimelinePropertyRef<Value> | undefined {
    const object = this.composition.getObject(this.objectKey)
    if (!object) return undefined
    return findPropertyRef(object.props, this.propertyPath) as
      | TimelinePropertyRef<Value>
      | undefined
  }

  get snapshot(): TrackSnapshot {
    const track = this.getTrackData()
    return {
      id: this.id,
      objectKey: this.objectKey,
      propertyPath: [...this.propertyPath],
      keyframes: JSON.parse(JSON.stringify(track.keyframes)) as TheatreKeyframe[],
    }
  }

  getKeyframe(id: string): TimelineKeyframe<Value> | undefined {
    if (!this.getTrackData().keyframes.some((keyframe) => keyframe.id === id)) {
      return undefined
    }
    return this.getOrCreateKeyframeHandle(id)
  }

  getOrCreateKeyframeHandle(id: string): TimelineKeyframe<Value> {
    let handle = this.keyframes.get(id)
    if (!handle) {
      handle = new TimelineKeyframe(this, id)
      this.keyframes.set(id, handle)
    }
    return handle
  }

  getKeyframes(): readonly TimelineKeyframe<Value>[] {
    return this.getTrackData().keyframes.map(
      (keyframe) => this.getOrCreateKeyframeHandle(keyframe.id),
    )
  }

  evaluate(time: number): Value | undefined {
    const interpolator = this.property?.config
    const value = evaluateTrack(
      this.getTrackData(),
      time,
      interpolator && interpolator.type !== 'compound'
        ? ((left, right, progression) =>
            interpolator.interpolate(
              interpolator.sanitize(left) as never,
              interpolator.sanitize(right) as never,
              progression,
            ) as SerializableValue)
        : undefined,
    )
    return value as Value | undefined
  }

  private getTrackData() {
    const track =
      this.composition.timeline.document.sheetsById[this.composition.id]?.sequence
        ?.tracksByObject[this.objectKey]?.trackData[this.id]
    if (!track) throw new Error(`El track ${this.id} ya no existe`)
    return track
  }
}

export class TimelineKeyframe<Value = unknown> {
  constructor(
    readonly track: TimelineTrack<Value>,
    readonly id: string,
  ) {}

  get address(): KeyframeAddress {
    return {...this.track.address, keyframeId: this.id}
  }

  get snapshot(): TheatreKeyframe {
    const keyframe = this.track.snapshot.keyframes.find(
      (candidate) => candidate.id === this.id,
    )
    if (!keyframe) throw new Error(`El keyframe ${this.id} ya no existe`)
    return JSON.parse(JSON.stringify(keyframe)) as TheatreKeyframe
  }
}

export class TimelineSequence {
  constructor(readonly composition: TimelineComposition) {}

  get position(): number {
    return this.composition.timeline.getPlayer(this.composition.id).position
  }

  set position(value: number) {
    this.seek(value)
  }

  get length(): number {
    return this.composition.timeline.getDuration(this.composition.id)
  }

  get fps(): number {
    return this.composition.timeline.getFps(this.composition.id)
  }

  get playing(): boolean {
    return this.composition.timeline.getPlayer(this.composition.id).playing
  }

  play(options: {loop?: boolean} = {}): void {
    this.composition.timeline.getPlayer(this.composition.id).play(options)
  }

  pause(): void {
    this.composition.timeline.getPlayer(this.composition.id).pause()
  }

  seek(position: number): void {
    this.composition.timeline.getPlayer(this.composition.id).seek(position)
  }

  subscribe(
    listener: (state: PlaybackState) => void,
    emitCurrent = true,
  ): () => void {
    return this.composition.timeline
      .getPlayer(this.composition.id)
      .subscribe(listener, emitCurrent)
  }
}

export class TimelineComposition {
  readonly sequence = new TimelineSequence(this)
  private readonly objects = new Map<string, TimelineObject>()
  private readonly tracks = new Map<string, TimelineTrack>()

  constructor(
    readonly timeline: Timeline411,
    readonly id: string,
  ) {}

  object<Props extends TimelineShorthandSchema>(
    id: string,
    schema: Props,
    options: TimelineObjectOptions = {},
  ): TimelineObject<Props> {
    const normalized = normalizePropSchema(schema)
    const existing = this.objects.get(id)
    if (existing && !options.reconfigure) {
      if (!schemasAreCompatible(existing.schema, normalized)) {
        throw new Error(
          `El objeto ${id} ya está declarado con un schema incompatible`,
        )
      }
      return existing as TimelineObject<Props>
    }
    if (existing) this.detachObject(id)

    this.timeline.store.transaction('Declarar objeto', (transaction) => {
      transaction.ensureObject({sheetId: this.id, objectKey: id})
    })
    const object = new TimelineObject<Props>(this, id, normalized)
    this.objects.set(id, object as TimelineObject)
    this.timeline.registerObject(object as TimelineObject)
    return object
  }

  getObject(id: string): TimelineObject | undefined {
    return this.objects.get(id)
  }

  getObjects(): readonly TimelineObject[] {
    return [...this.objects.values()]
  }

  detachObject(id: string): boolean {
    const object = this.objects.get(id)
    if (!object) return false
    this.objects.delete(id)
    this.timeline.unregisterObject(object)
    return true
  }

  getTrack(id: string): TimelineTrack | undefined {
    const located = locateTrack(this.timeline, this.id, id)
    if (!located) return undefined
    return this.getOrCreateTrack(located.objectKey, id, located.path)
  }

  getTracks(): readonly TimelineTrack[] {
    const tracks: TimelineTrack[] = []
    const objects =
      this.timeline.document.sheetsById[this.id]?.sequence?.tracksByObject ?? {}
    for (const [objectKey, objectTracks] of Object.entries(objects)) {
      for (const [encodedPath, trackId] of Object.entries(
        objectTracks.trackIdByPropPath,
      )) {
        tracks.push(
          this.getOrCreateTrack(objectKey, trackId, decodePropertyPath(encodedPath)),
        )
      }
    }
    return tracks
  }

  getTrackFor<Value>(
    property: TimelinePropertyRef<Value>,
  ): TimelineTrack<Value> | undefined {
    if (property.object.composition !== this) return undefined
    const objectTracks =
      this.timeline.document.sheetsById[this.id]?.sequence?.tracksByObject[
        property.object.id
      ]
    const trackId = objectTracks?.trackIdByPropPath[
      encodePropertyPath(property.path)
    ]
    if (!trackId) return undefined
    return this.getOrCreateTrack(
      property.object.id,
      trackId,
      property.path,
    ) as unknown as TimelineTrack<Value>
  }

  getOrCreateTrack(
    objectKey: string,
    trackId: string,
    path: PropertyPath,
  ): TimelineTrack {
    let handle = this.tracks.get(trackId)
    if (!handle) {
      handle = new TimelineTrack(this, objectKey, trackId, path)
      this.tracks.set(trackId, handle)
    }
    return handle
  }
}

function buildPropertyRefs(
  object: TimelineObject<TimelineShorthandSchema>,
  schema: NormalizedPropSchema,
  prefix: readonly string[] = [],
): Record<string, TimelinePropertyRef> {
  const refs: Record<string, TimelinePropertyRef> = {}
  for (const [key, config] of Object.entries(schema)) {
    const ref = new TimelinePropertyRef(object, [...prefix, key], config)
    if (config.type === 'compound') {
      Object.assign(ref, buildPropertyRefs(object, config.props, [...prefix, key]))
    }
    refs[key] = ref
  }
  return refs
}

function findPropertyRef(
  refs: object,
  path: PropertyPath,
): TimelinePropertyRef | undefined {
  let current: unknown = refs
  for (const part of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return isTimelinePropertyRef(current) ? current : undefined
}

function locateTrack(
  timeline: Timeline411,
  sheetId: string,
  trackId: string,
): {objectKey: string; path: PropertyPath} | undefined {
  const objects = timeline.document.sheetsById[sheetId]?.sequence?.tracksByObject
  if (!objects) return undefined
  for (const [objectKey, objectTracks] of Object.entries(objects)) {
    for (const [encodedPath, candidate] of Object.entries(
      objectTracks.trackIdByPropPath,
    )) {
      if (candidate === trackId) {
        return {objectKey, path: decodePropertyPath(encodedPath)}
      }
    }
  }
  return undefined
}

function stableValue(value: unknown): string {
  return JSON.stringify(value)
}

export type AnyTimelinePropertyRef = TimelinePropertyRef<
  PropValue<TimelineShorthandProp>
>
