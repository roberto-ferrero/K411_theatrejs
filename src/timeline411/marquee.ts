import type {KeyframeAddress, TimelineDocument} from './model'
import type {TimelineRow} from './projection'

export interface TimelineMarqueeBounds {
  readonly timeStart: number
  readonly timeEnd: number
  /** Coordenada de fila: 0 es el borde superior de la primera fila. */
  readonly rowStart: number
  readonly rowEnd: number
}

export interface NormalizedTimelineMarqueeBounds {
  readonly timeMin: number
  readonly timeMax: number
  readonly rowMin: number
  readonly rowMax: number
}

export function normalizeTimelineMarqueeBounds(
  bounds: TimelineMarqueeBounds,
): NormalizedTimelineMarqueeBounds {
  const values = [
    bounds.timeStart,
    bounds.timeEnd,
    bounds.rowStart,
    bounds.rowEnd,
  ]
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Los límites de marquee deben ser números finitos')
  }
  return {
    timeMin: Math.min(bounds.timeStart, bounds.timeEnd),
    timeMax: Math.max(bounds.timeStart, bounds.timeEnd),
    rowMin: Math.min(bounds.rowStart, bounds.rowEnd),
    rowMax: Math.max(bounds.rowStart, bounds.rowEnd),
  }
}

/**
 * Hit testing renderer-neutral. Selecciona el centro de filas con track real y
 * omite los keyframes agregados de objetos o grupos.
 */
export function collectKeyframesInMarquee(
  document: TimelineDocument,
  sheetId: string,
  rows: readonly TimelineRow[],
  bounds: TimelineMarqueeBounds,
): readonly KeyframeAddress[] {
  const normalized = normalizeTimelineMarqueeBounds(bounds)
  const tracks = document.sheetsById[sheetId]?.sequence?.tracksByObject
  if (!tracks) return []

  const matches: KeyframeAddress[] = []
  rows.forEach((row, rowIndex) => {
    if (!row.trackId) return
    const rowCenter = rowIndex + 0.5
    if (rowCenter < normalized.rowMin || rowCenter > normalized.rowMax) return
    const track = tracks[row.objectKey]?.trackData[row.trackId]
    if (!track) return
    for (const keyframe of track.keyframes) {
      if (
        keyframe.position < normalized.timeMin ||
        keyframe.position > normalized.timeMax
      ) {
        continue
      }
      matches.push({
        sheetId,
        objectKey: row.objectKey,
        trackId: row.trackId,
        keyframeId: keyframe.id,
      })
    }
  })
  return matches
}
