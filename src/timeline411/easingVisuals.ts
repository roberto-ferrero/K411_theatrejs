import type {
  EasingPreset,
  KeyframeAddress,
  TheatreKeyframe,
  TimelineDocument,
} from './model'
import {easingPresetPoints} from './store'

export type EasingDisplayId = EasingPreset | 'imported' | 'none'

export interface EasingVisualDescriptor {
  readonly id: EasingDisplayId
  readonly label: string
  readonly color: string
  readonly cssVariable: string
  readonly kind: 'bezier' | 'hold' | 'none'
  readonly handles?: readonly [number, number, number, number]
  readonly dashArray?: string
}

export const selectableEasingPresets: readonly EasingPreset[] = [
  'linear',
  'hold',
  'ease',
  'easeIn',
  'easeOut',
  'easeInOut',
]

const easingVisualMetadata: Record<
  EasingDisplayId,
  Omit<EasingVisualDescriptor, 'handles'>
> = {
  none: {
    id: 'none',
    label: 'Sin segmento',
    color: '#667085',
    cssVariable: '--k411-easing-none',
    kind: 'none',
  },
  imported: {
    id: 'imported',
    label: 'Curva importada',
    color: '#ff8a65',
    cssVariable: '--k411-easing-imported',
    kind: 'bezier',
    dashArray: '7 3 1.5 3',
  },
  linear: {
    id: 'linear',
    label: 'Linear',
    color: '#a7b0be',
    cssVariable: '--k411-easing-linear',
    kind: 'bezier',
  },
  hold: {
    id: 'hold',
    label: 'Hold',
    color: '#f2b84b',
    cssVariable: '--k411-easing-hold',
    kind: 'hold',
    dashArray: '4 3',
  },
  ease: {
    id: 'ease',
    label: 'Ease',
    color: '#5da9ff',
    cssVariable: '--k411-easing-ease',
    kind: 'bezier',
  },
  easeIn: {
    id: 'easeIn',
    label: 'Ease In',
    color: '#a78bfa',
    cssVariable: '--k411-easing-ease-in',
    kind: 'bezier',
  },
  easeOut: {
    id: 'easeOut',
    label: 'Ease Out',
    color: '#43d3b0',
    cssVariable: '--k411-easing-ease-out',
    kind: 'bezier',
  },
  easeInOut: {
    id: 'easeInOut',
    label: 'Ease In Out',
    color: '#f078c8',
    cssVariable: '--k411-easing-ease-in-out',
    kind: 'bezier',
  },
}

export function getEasingVisualDescriptor(
  id: EasingDisplayId,
  importedHandles?: readonly [number, number, number, number],
): EasingVisualDescriptor {
  const metadata = easingVisualMetadata[id]
  if (id === 'none' || id === 'hold') return metadata
  const handles = id === 'imported'
    ? importedHandles ?? [0.25, 0.1, 0.25, 1]
    : easingPresetPoints[id]
  return {...metadata, handles}
}

export function getSegmentEasingVisual(
  left: TheatreKeyframe,
  right: TheatreKeyframe | undefined,
): EasingVisualDescriptor {
  if (!right) return getEasingVisualDescriptor('none')
  if (!left.connectedRight || left.type === 'hold') {
    return getEasingVisualDescriptor('hold')
  }
  const handles: [number, number, number, number] = [
    left.handles[2],
    left.handles[3],
    right.handles[0],
    right.handles[1],
  ]
  if (left.type !== 'bezier') {
    return getEasingVisualDescriptor('imported', handles)
  }
  for (const preset of selectableEasingPresets) {
    if (preset === 'hold') continue
    const expected = easingPresetPoints[preset]
    if (handles.every((point, index) => Math.abs(point - expected[index]) < 1e-6)) {
      return getEasingVisualDescriptor(preset)
    }
  }
  return getEasingVisualDescriptor('imported', handles)
}

export function getKeyframeEasingVisual(
  document: TimelineDocument,
  address: KeyframeAddress,
): EasingVisualDescriptor {
  const track = document.sheetsById[address.sheetId]?.sequence?.tracksByObject[
    address.objectKey
  ]?.trackData[address.trackId]
  const index = track?.keyframes.findIndex(
    (keyframe) => keyframe.id === address.keyframeId,
  ) ?? -1
  if (!track || index < 0) return getEasingVisualDescriptor('none')
  return getSegmentEasingVisual(track.keyframes[index], track.keyframes[index + 1])
}

export function isSelectableEasingPreset(value: string): value is EasingPreset {
  return selectableEasingPresets.some((preset) => preset === value)
}
