import type {
  EvaluatedSheet,
  KeyframeAddress,
  SerializableMap,
  SerializableValue,
  TheatreKeyframe,
  TimelineDocument,
} from './model'
import {
  decodePropertyPath,
  encodePropertyPath,
  getValueAtPath,
  isSerializableMap,
} from './paths'

export type TimelineRowKind = 'object' | 'group' | 'track' | 'static'

export interface TimelineRow {
  readonly id: string
  readonly label: string
  readonly depth: number
  readonly kind: TimelineRowKind
  readonly objectKey: string
  readonly path: readonly string[]
  readonly trackId?: string
  readonly trackIds: readonly string[]
}

export type TimelineRowValueMode =
  | 'hidden'
  | 'readonly'
  | 'static'
  | 'keyframe'

export interface TimelineRowValueProjection {
  readonly mode: TimelineRowValueMode
  readonly value?: SerializableValue
  readonly keyframe?: KeyframeAddress
}

interface MutableRowNode {
  label: string
  objectKey: string
  path: string[]
  trackId?: string
  children: Map<string, MutableRowNode>
}

export interface GridTick {
  readonly time: number
  readonly x: number
  readonly major: boolean
  readonly label: string
}

export function buildTimelineRows(
  document: TimelineDocument,
  sheetId: string,
): readonly TimelineRow[] {
  const sheet = document.sheetsById[sheetId]
  if (!sheet) return []
  const objectKeys = new Set([
    ...Object.keys(sheet.staticOverrides.byObject),
    ...Object.keys(sheet.sequence?.tracksByObject ?? {}),
  ])
  const rows: TimelineRow[] = []

  for (const objectKey of [...objectKeys].sort()) {
    const root: MutableRowNode = {
      label: objectKey,
      objectKey,
      path: [],
      children: new Map(),
    }
    const objectTracks = sheet.sequence?.tracksByObject[objectKey]
    for (const [encodedPath, trackId] of Object.entries(
      objectTracks?.trackIdByPropPath ?? {},
    )) {
      insertPath(root, decodePropertyPath(encodedPath), trackId)
    }
    insertStaticLeaves(
      root,
      sheet.staticOverrides.byObject[objectKey] ?? {},
      [],
    )
    flattenNode(root, 0, objectTracks?.trackData ?? {}, rows)
  }
  return rows
}

export function collectRowKeyframes(
  document: TimelineDocument,
  sheetId: string,
  row: TimelineRow,
): readonly TheatreKeyframe[] {
  const tracks =
    document.sheetsById[sheetId]?.sequence?.tracksByObject[row.objectKey]
      ?.trackData
  if (!tracks) return []
  if (row.trackId) return tracks[row.trackId]?.keyframes ?? []

  const byPosition = new Map<number, TheatreKeyframe>()
  for (const trackId of row.trackIds) {
    for (const keyframe of tracks[trackId]?.keyframes ?? []) {
      if (!byPosition.has(keyframe.position)) byPosition.set(keyframe.position, keyframe)
    }
  }
  return [...byPosition.values()].sort((left, right) => left.position - right.position)
}

export function projectTimelineRowValue(
  document: TimelineDocument,
  sheetId: string,
  row: TimelineRow,
  position: number,
  evaluated: EvaluatedSheet,
): TimelineRowValueProjection {
  if ((row.kind !== 'track' && row.kind !== 'static') || row.path.length === 0) {
    return {mode: 'hidden'}
  }

  const value = getValueAtPath(evaluated.objects[row.objectKey] ?? {}, row.path)
  if (!row.trackId) return {mode: 'static', value}

  const track =
    document.sheetsById[sheetId]?.sequence?.tracksByObject[row.objectKey]
      ?.trackData[row.trackId]
  const keyframe = track?.keyframes.find(
    (candidate) => Math.abs(candidate.position - position) < 1e-6,
  )
  if (!keyframe) return {mode: 'readonly', value}

  return {
    mode: 'keyframe',
    value,
    keyframe: {
      sheetId,
      objectKey: row.objectKey,
      trackId: row.trackId,
      keyframeId: keyframe.id,
    },
  }
}

export function timeToX(time: number, duration: number, width: number): number {
  if (duration <= 0) return 0
  return (time / duration) * width
}

export function xToTime(x: number, duration: number, width: number): number {
  if (width <= 0) return 0
  return Math.max(0, Math.min(duration, (x / width) * duration))
}

export function snapToFrame(time: number, fps: number): number {
  return Number((Math.round(time * fps) / fps).toFixed(6))
}

export function createGridTicks(
  duration: number,
  width: number,
  fps: number,
  minimumSpacing = 54,
): readonly GridTick[] {
  if (duration <= 0 || width <= 0) return []
  const pixelsPerSecond = width / duration
  const candidates = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 30, 60]
  const step =
    candidates.find((candidate) => candidate * pixelsPerSecond >= minimumSpacing) ??
    60
  const ticks: GridTick[] = []

  for (let time = 0; time <= duration + step * 0.001; time += step) {
    const rounded = Number(time.toFixed(6))
    const isWholeSecond = Math.abs(rounded - Math.round(rounded)) < 1e-6
    ticks.push({
      time: rounded,
      x: timeToX(rounded, duration, width),
      major: isWholeSecond,
      label: formatTimelineTime(rounded, fps),
    })
  }
  return ticks
}

export function formatTimelineTime(time: number, fps: number): string {
  const seconds = Math.floor(time)
  const frames = Math.round((time - seconds) * fps)
  return frames === 0 ? `${seconds}s` : `${seconds}s ${frames}f`
}

function insertPath(root: MutableRowNode, path: readonly string[], trackId: string): void {
  let current = root
  path.forEach((part, index) => {
    let child = current.children.get(part)
    if (!child) {
      child = {
        label: part,
        objectKey: root.objectKey,
        path: path.slice(0, index + 1),
        children: new Map(),
      }
      current.children.set(part, child)
    }
    current = child
  })
  current.trackId = trackId
}

function insertStaticLeaves(
  root: MutableRowNode,
  value: SerializableMap,
  prefix: readonly string[],
): void {
  for (const [key, childValue] of Object.entries(value)) {
    const path = [...prefix, key]
    if (isSerializableMap(childValue)) {
      insertStaticLeaves(root, childValue, path)
    } else {
      ensureStaticPath(root, path)
    }
  }
}

function ensureStaticPath(
  root: MutableRowNode,
  path: readonly string[],
): void {
  let current = root
  path.forEach((part, index) => {
    let child = current.children.get(part)
    if (!child) {
      child = {
        label: part,
        objectKey: root.objectKey,
        path: path.slice(0, index + 1),
        children: new Map(),
      }
      current.children.set(part, child)
    }
    current = child
  })
}

function flattenNode(
  node: MutableRowNode,
  depth: number,
  tracks: Readonly<Record<string, {keyframes: readonly TheatreKeyframe[]}>>,
  output: TimelineRow[],
): readonly string[] {
  const childTrackIds: string[] = []
  const childRows: TimelineRow[] = []
  for (const child of [...node.children.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  )) {
    childTrackIds.push(...flattenNode(child, depth + 1, tracks, childRows))
  }
  const ownTrackIds = node.trackId ? [node.trackId] : []
  const trackIds = [...new Set([...ownTrackIds, ...childTrackIds])]
  const kind: TimelineRowKind =
    depth === 0
      ? 'object'
      : node.trackId
        ? 'track'
        : node.children.size > 0
          ? 'group'
          : 'static'
  output.push({
    id: `${node.objectKey}:${encodePropertyPath(node.path)}`,
    label: node.label,
    depth,
    kind,
    objectKey: node.objectKey,
    path: node.path,
    trackId: node.trackId,
    trackIds,
  })
  output.push(...childRows)
  return trackIds.filter((trackId) => Boolean(tracks[trackId]))
}
