export type SerializablePrimitive = string | number | boolean

export interface SerializableMap {
  [key: string]: SerializableValue | undefined
}

export type SerializableValue = SerializablePrimitive | SerializableMap

export type PropertyPath = readonly string[]

export interface TheatreProjectState {
  sheetsById: Record<string, TheatreSheetState>
  definitionVersion: '0.4.0'
  revisionHistory: string[]
}

export type TimelineDocument = TheatreProjectState

export interface TheatreSheetState {
  staticOverrides: {
    byObject: Record<string, SerializableMap>
  }
  sequence?: TheatreSequenceState
}

export interface TheatreSequenceState {
  type: 'PositionalSequence'
  length: number
  subUnitsPerUnit: number
  tracksByObject: Record<string, TheatreObjectTracksState>
}

export interface TheatreObjectTracksState {
  trackIdByPropPath: Record<string, string>
  trackData: Record<string, TheatreBasicKeyframedTrack>
}

export type TheatreKeyframeType = 'bezier' | 'hold'

export interface TheatreKeyframe {
  id: string
  value: SerializableValue
  position: number
  handles: [number, number, number, number]
  connectedRight: boolean
  type?: TheatreKeyframeType
}

export interface TheatreBasicKeyframedTrack {
  type: 'BasicKeyframedTrack'
  __debugName?: string
  keyframes: TheatreKeyframe[]
}

export type EasingPreset =
  | 'linear'
  | 'hold'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'

export interface TrackAddress {
  sheetId: string
  objectKey: string
  trackId: string
}

export interface ObjectAddress {
  sheetId: string
  objectKey: string
}

export interface PropertyAddress extends ObjectAddress {
  path: PropertyPath
}

export interface KeyframeAddress extends TrackAddress {
  keyframeId: string
}

export interface EvaluatedSheet {
  readonly sheetId: string
  readonly time: number
  readonly objects: Readonly<Record<string, SerializableMap>>
}

export function cloneDocument(document: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(document)) as TimelineDocument
}

export function cloneValue<T extends SerializableValue | undefined>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
