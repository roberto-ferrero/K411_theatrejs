import type {
  KeyframeAddress,
  SerializableValue,
  TheatreKeyframe,
  TimelineDocument,
} from './model'
import {cloneValue} from './model'
import {encodePropertyPath, getValueAtPath, isSerializableMap} from './paths'

export const timelineEventsObjectKey = '__Timeline411_Events__'
export const timelineEventsGroupRowId = '__Timeline411_Events_Group__'
export const timelineEventCueValuePrefix = '__timeline411_event__:'

const metadataRoot = '__timeline411'
const familyMetadataKey = 'eventFamilies'
const eventTracksRoot = 'events'

export interface TimelineEventFamilyAddress {
  readonly sheetId: string
  readonly familyId: string
}

export interface TimelineEventFamily extends TimelineEventFamilyAddress {
  readonly label: string
  readonly objectKey: typeof timelineEventsObjectKey
  readonly trackId: string
  readonly path: readonly [typeof eventTracksRoot, string]
  readonly cues: readonly TimelineEventCue[]
}

export interface TimelineEventCueData {
  readonly label?: string
  readonly payload?: SerializableValue
}

export interface TimelineEventCue extends TimelineEventCueData {
  readonly id: string
  readonly familyId: string
  readonly familyLabel: string
  readonly position: number
  readonly address: KeyframeAddress
}

export interface TimelineEventTrigger extends TimelineEventCue {
  readonly type: 'event:trigger'
  readonly previousPosition: number
  readonly currentPosition: number
  readonly direction: 'forward' | 'reverse'
  readonly iteration: number
}

export function timelineEventFamilyPath(
  familyId: string,
): readonly [typeof eventTracksRoot, string] {
  return [eventTracksRoot, familyId]
}

export function timelineEventFamilyLabelPath(familyId: string): readonly string[] {
  return [metadataRoot, familyMetadataKey, familyId, 'label']
}

export function getTimelineEventFamilies(
  document: TimelineDocument,
  sheetId: string,
): readonly TimelineEventFamily[] {
  const sheet = document.sheetsById[sheetId]
  if (!sheet) return []
  const objectValues = sheet.staticOverrides.byObject[timelineEventsObjectKey]
  const metadata = getValueAtPath(objectValues ?? {}, [metadataRoot, familyMetadataKey])
  if (!isSerializableMap(metadata)) return []
  const objectTracks = sheet.sequence?.tracksByObject[timelineEventsObjectKey]
  if (!objectTracks) return []

  const families: TimelineEventFamily[] = []
  for (const [familyId, rawMetadata] of Object.entries(metadata)) {
    if (!isSerializableMap(rawMetadata) || typeof rawMetadata.label !== 'string') {
      continue
    }
    const path = timelineEventFamilyPath(familyId)
    const trackId = objectTracks.trackIdByPropPath[encodePropertyPath(path)]
    const track = trackId ? objectTracks.trackData[trackId] : undefined
    if (!track) continue
    const label = rawMetadata.label
    families.push({
      sheetId,
      familyId,
      label,
      objectKey: timelineEventsObjectKey,
      trackId,
      path,
      cues: track.keyframes.map((keyframe) =>
        createCueSnapshot(sheetId, familyId, label, trackId, keyframe),
      ),
    })
  }
  return families
}

export function getTimelineEventFamily(
  document: TimelineDocument,
  address: TimelineEventFamilyAddress,
): TimelineEventFamily | undefined {
  return getTimelineEventFamilies(document, address.sheetId).find(
    ({familyId}) => familyId === address.familyId,
  )
}

export function getTimelineEventFamilyByTrack(
  document: TimelineDocument,
  sheetId: string,
  trackId: string,
): TimelineEventFamily | undefined {
  return getTimelineEventFamilies(document, sheetId).find(
    (family) => family.trackId === trackId,
  )
}

export function getTimelineEventCue(
  document: TimelineDocument,
  address: KeyframeAddress,
): TimelineEventCue | undefined {
  if (address.objectKey !== timelineEventsObjectKey) return undefined
  const family = getTimelineEventFamilyByTrack(
    document,
    address.sheetId,
    address.trackId,
  )
  return family?.cues.find(({id}) => id === address.keyframeId)
}

export function isTimelineEventCueAddress(
  document: TimelineDocument,
  address: KeyframeAddress | undefined,
): address is KeyframeAddress {
  return Boolean(address && getTimelineEventCue(document, address))
}

export function encodeTimelineEventCue(data: TimelineEventCueData): string {
  const normalized: {label?: string; payload?: SerializableValue} = {}
  const label = data.label?.trim()
  if (label) normalized.label = label
  if (typeof data.payload !== 'undefined') {
    if (!isTimelineEventPayload(data.payload)) {
      throw new Error('El payload del evento debe ser un valor JSON serializable')
    }
    normalized.payload = cloneValue(data.payload)
  }
  return timelineEventCueValuePrefix + JSON.stringify(normalized)
}

export function decodeTimelineEventCue(value: SerializableValue): TimelineEventCueData {
  if (
    typeof value !== 'string' ||
    !value.startsWith(timelineEventCueValuePrefix)
  ) {
    return {}
  }
  try {
    const parsed = JSON.parse(
      value.slice(timelineEventCueValuePrefix.length),
    ) as SerializableValue
    if (!isSerializableMap(parsed)) return {}
    const label = typeof parsed.label === 'string' && parsed.label.trim()
      ? parsed.label.trim()
      : undefined
    const payload = parsed.payload
    return {
      ...(label ? {label} : {}),
      ...(typeof payload !== 'undefined' && isTimelineEventPayload(payload)
        ? {payload: cloneValue(payload)}
        : {}),
    }
  } catch {
    return {}
  }
}

export function isTimelineEventPayload(value: unknown): value is SerializableValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((child) =>
    typeof child !== 'undefined' && isTimelineEventPayload(child),
  )
}

function createCueSnapshot(
  sheetId: string,
  familyId: string,
  familyLabel: string,
  trackId: string,
  keyframe: TheatreKeyframe,
): TimelineEventCue {
  return {
    id: keyframe.id,
    familyId,
    familyLabel,
    position: keyframe.position,
    address: {
      sheetId,
      objectKey: timelineEventsObjectKey,
      trackId,
      keyframeId: keyframe.id,
    },
    ...decodeTimelineEventCue(keyframe.value),
  }
}
