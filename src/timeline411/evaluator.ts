import {solveCubicBezier} from './easing'
import type {
  EvaluatedSheet,
  SerializableMap,
  SerializableValue,
  TheatreBasicKeyframedTrack,
  TheatreKeyframe,
  TimelineDocument,
} from './model'
import {cloneValue} from './model'
import {decodePropertyPath, isSerializableMap, setValueAtPath} from './paths'

export type ValueInterpolator = (
  left: SerializableValue,
  right: SerializableValue,
  progression: number,
) => SerializableValue

export function evaluateTrack(
  track: TheatreBasicKeyframedTrack,
  time: number,
  interpolator: ValueInterpolator = interpolateValue,
): SerializableValue | undefined {
  const keyframes = track.keyframes
  if (keyframes.length === 0) return undefined
  if (time <= keyframes[0].position) return cloneValue(keyframes[0].value)

  const last = keyframes[keyframes.length - 1]
  if (time >= last.position) return cloneValue(last.value)

  const rightIndex = findFirstKeyframeAfter(keyframes, time)
  const left = keyframes[rightIndex - 1]
  const right = keyframes[rightIndex]
  const linearProgress =
    (time - left.position) / (right.position - left.position)

  if (!left.connectedRight || left.type === 'hold') {
    return cloneValue(left.value)
  }

  const valueProgress = solveCubicBezier(
    linearProgress,
    left.handles[2],
    left.handles[3],
    right.handles[0],
    right.handles[1],
  )
  return interpolator(left.value, right.value, valueProgress)
}

export function evaluateSheet(
  document: TimelineDocument,
  sheetId: string,
  requestedTime: number,
  defaults: Readonly<Record<string, SerializableMap>> = {},
  interpolators: Readonly<
    Record<string, Readonly<Record<string, ValueInterpolator>>>
  > = {},
): EvaluatedSheet {
  const sheet = document.sheetsById[sheetId]
  if (!sheet) throw new Error(`Sheet desconocida: ${sheetId}`)
  const duration = sheet.sequence?.length ?? 0
  const time = Math.max(0, Math.min(duration, requestedTime))
  const objects: Record<string, SerializableMap> = {}
  const objectKeys = new Set([
    ...Object.keys(defaults),
    ...Object.keys(sheet.staticOverrides.byObject),
    ...Object.keys(sheet.sequence?.tracksByObject ?? {}),
  ])

  for (const objectKey of objectKeys) {
    const value = cloneMap(defaults[objectKey] ?? {})
    mergeMaps(value, sheet.staticOverrides.byObject[objectKey] ?? {})
    objects[objectKey] = value
  }

  for (const [objectKey, objectTracks] of Object.entries(
    sheet.sequence?.tracksByObject ?? {},
  )) {
    const objectValue = objects[objectKey] ?? (objects[objectKey] = {})
    for (const [encodedPath, trackId] of Object.entries(
      objectTracks.trackIdByPropPath,
    )) {
      const track = objectTracks.trackData[trackId]
      if (!track) continue
      const value = evaluateTrack(
        track,
        time,
        interpolators[objectKey]?.[encodedPath],
      )
      if (typeof value !== 'undefined') {
        setValueAtPath(objectValue, decodePropertyPath(encodedPath), value)
      }
    }
  }

  return {sheetId, time, objects}
}

function findFirstKeyframeAfter(
  keyframes: readonly TheatreKeyframe[],
  time: number,
): number {
  let low = 0
  let high = keyframes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (keyframes[middle].position <= time) low = middle + 1
    else high = middle
  }
  return low
}

function interpolateValue(
  left: SerializableValue,
  right: SerializableValue,
  progress: number,
): SerializableValue {
  if (typeof left === 'number' && typeof right === 'number') {
    return left + (right - left) * progress
  }
  if (isSerializableMap(left) && isSerializableMap(right)) {
    const result: SerializableMap = {}
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const leftChild = left[key]
      const rightChild = right[key]
      if (typeof leftChild === 'undefined') result[key] = cloneValue(rightChild)
      else if (typeof rightChild === 'undefined') result[key] = cloneValue(leftChild)
      else result[key] = interpolateValue(leftChild, rightChild, progress)
    }
    return result
  }
  return cloneValue(progress < 1 ? left : right)
}

function cloneMap(value: SerializableMap): SerializableMap {
  return cloneValue(value) as SerializableMap
}

function mergeMaps(target: SerializableMap, source: SerializableMap): void {
  for (const [key, value] of Object.entries(source)) {
    if (isSerializableMap(value) && isSerializableMap(target[key])) {
      mergeMaps(target[key] as SerializableMap, value)
    } else {
      target[key] = cloneValue(value)
    }
  }
}
