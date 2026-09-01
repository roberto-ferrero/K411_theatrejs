export type TimelineViewportMode = 'fit' | 'manual'

export type TimelineViewportChangeReason =
  | 'zoom'
  | 'pan'
  | 'scroll'
  | 'resize'
  | 'fit'
  | 'programmatic'
  | 'duration'
  | 'content'

export const maximumUnzoomContentRatio = 2 / 3

export interface TimelineViewportSnapshot {
  readonly visibleStart: number
  readonly visibleEnd: number
  readonly visibleRange: readonly [number, number]
  readonly duration: number
  readonly contentEnd: number
  readonly maximumVisibleSpan: number
  readonly fps: number
  readonly width: number
  readonly zoom: number
  readonly mode: TimelineViewportMode
}

export interface TimelineViewportChange {
  readonly reason: TimelineViewportChangeReason
  readonly previous: TimelineViewportSnapshot
  readonly snapshot: TimelineViewportSnapshot
}

export interface TimelineViewportOptions {
  readonly duration: number
  readonly fps: number
  readonly width?: number
  readonly contentEnd?: number
}

type ViewportListener = (change: TimelineViewportChange) => void

export class TimelineViewport {
  private visibleStartValue = 0
  private visibleEndValue: number
  private durationValue: number
  private contentEndValue: number
  private fpsValue: number
  private widthValue: number
  private modeValue: TimelineViewportMode = 'fit'
  private readonly listeners = new Set<ViewportListener>()

  constructor(options: TimelineViewportOptions) {
    assertDuration(options.duration)
    assertFps(options.fps)
    this.durationValue = options.duration
    this.contentEndValue = normalizeContentEnd(
      options.duration,
      options.contentEnd ?? options.duration,
    )
    this.fpsValue = options.fps
    this.widthValue = normalizeWidth(options.width ?? 1)
    this.visibleEndValue = this.contentEndValue
  }

  get snapshot(): TimelineViewportSnapshot {
    const span = this.visibleEndValue - this.visibleStartValue
    return {
      visibleStart: this.visibleStartValue,
      visibleEnd: this.visibleEndValue,
      visibleRange: [this.visibleStartValue, this.visibleEndValue],
      duration: this.durationValue,
      contentEnd: this.contentEndValue,
      maximumVisibleSpan: getMaximumVisibleSpan(this.contentEndValue),
      fps: this.fpsValue,
      width: this.widthValue,
      zoom: span > 0 ? this.contentEndValue / span : 1,
      mode: this.modeValue,
    }
  }

  onChange(listener: ViewportListener, emitCurrent = false): () => void {
    this.listeners.add(listener)
    if (emitCurrent) {
      const snapshot = this.snapshot
      listener({reason: 'programmatic', previous: snapshot, snapshot})
    }
    return () => this.listeners.delete(listener)
  }

  setMetrics(
    duration: number,
    fps: number,
    width: number,
    contentEnd = duration,
  ): boolean {
    assertDuration(duration)
    assertFps(fps)
    const previous = this.snapshot
    const durationChanged = !nearlyEqual(duration, this.durationValue)
    const normalizedContentEnd = normalizeContentEnd(duration, contentEnd)
    const contentChanged = !nearlyEqual(
      normalizedContentEnd,
      this.contentEndValue,
    )
    this.durationValue = duration
    this.contentEndValue = normalizedContentEnd
    this.fpsValue = fps
    this.widthValue = normalizeWidth(width)

    if (this.modeValue === 'fit') {
      this.visibleStartValue = 0
      this.visibleEndValue = this.contentEndValue
    } else {
      const center = (previous.visibleStart + previous.visibleEnd) / 2
      const range = normalizeVisibleRange(
        center - (previous.visibleEnd - previous.visibleStart) / 2,
        center + (previous.visibleEnd - previous.visibleStart) / 2,
        duration,
        fps,
        this.contentEndValue,
      )
      this.visibleStartValue = range[0]
      this.visibleEndValue = range[1]
    }

    return this.emitIfChanged(
      previous,
      durationChanged ? 'duration' : contentChanged ? 'content' : 'resize',
    )
  }

  fitToSequence(): boolean {
    const previous = this.snapshot
    this.visibleStartValue = 0
    this.visibleEndValue = this.contentEndValue
    this.modeValue = 'fit'
    return this.emitIfChanged(previous, 'fit')
  }

  setVisibleRange(
    start: number,
    end: number,
    reason: TimelineViewportChangeReason = 'programmatic',
  ): boolean {
    const previous = this.snapshot
    const range = normalizeVisibleRange(
      start,
      end,
      this.durationValue,
      this.fpsValue,
      this.contentEndValue,
    )
    this.visibleStartValue = range[0]
    this.visibleEndValue = range[1]
    this.modeValue = 'manual'
    return this.emitIfChanged(previous, reason)
  }

  zoomAt(
    time: number,
    factor: number,
    reason: TimelineViewportChangeReason = 'zoom',
  ): boolean {
    if (!Number.isFinite(time)) throw new Error('El ancla de zoom debe ser finita')
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error('El factor de zoom debe ser mayor que cero')
    }
    const currentSpan = this.visibleEndValue - this.visibleStartValue
    const minimumSpan = getMinimumVisibleSpan(this.durationValue, this.fpsValue)
    const nextSpan = clamp(
      currentSpan / factor,
      minimumSpan,
      getMaximumVisibleSpan(this.contentEndValue),
    )
    const anchor = clamp(time, this.visibleStartValue, this.visibleEndValue)
    const anchorRatio = currentSpan > 0
      ? (anchor - this.visibleStartValue) / currentSpan
      : 0.5
    const start = anchor - anchorRatio * nextSpan
    return this.setVisibleRange(start, start + nextSpan, reason)
  }

  panBy(
    deltaTime: number,
    reason: TimelineViewportChangeReason = 'pan',
  ): boolean {
    if (!Number.isFinite(deltaTime)) throw new Error('El desplazamiento debe ser finito')
    const span = this.visibleEndValue - this.visibleStartValue
    return this.setVisibleRange(
      this.visibleStartValue + deltaTime,
      this.visibleStartValue + deltaTime + span,
      reason,
    )
  }

  private emitIfChanged(
    previous: TimelineViewportSnapshot,
    reason: TimelineViewportChangeReason,
  ): boolean {
    const snapshot = this.snapshot
    if (snapshotsAreEqual(previous, snapshot)) return false
    const change = {reason, previous, snapshot}
    for (const listener of this.listeners) listener(change)
    return true
  }
}

export function getMinimumVisibleSpan(duration: number, fps: number): number {
  assertDuration(duration)
  assertFps(fps)
  return Math.min(duration, Math.max(2 / fps, 0.05))
}

export function getMaximumVisibleSpan(contentEnd: number): number {
  assertPositiveFinite(contentEnd, 'El final del contenido')
  return contentEnd / maximumUnzoomContentRatio
}

export function normalizeVisibleRange(
  start: number,
  end: number,
  duration: number,
  fps: number,
  contentEnd = duration,
): readonly [number, number] {
  assertDuration(duration)
  assertFps(fps)
  const normalizedContentEnd = normalizeContentEnd(duration, contentEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('El rango visible no es válido')
  }
  const minimumSpan = getMinimumVisibleSpan(duration, fps)
  const span = clamp(
    end - start,
    minimumSpan,
    getMaximumVisibleSpan(normalizedContentEnd),
  )
  if (span >= normalizedContentEnd) return [0, span]
  let normalizedStart = (start + end) / 2 - span / 2
  normalizedStart = clamp(
    normalizedStart,
    0,
    Math.max(0, normalizedContentEnd - span),
  )
  return [normalizedStart, normalizedStart + span]
}

export function timeToViewportX(
  time: number,
  viewport: TimelineViewportSnapshot,
): number {
  const span = viewport.visibleEnd - viewport.visibleStart
  if (span <= 0) return 0
  return ((time - viewport.visibleStart) / span) * viewport.width
}

export function viewportXToTime(
  x: number,
  viewport: TimelineViewportSnapshot,
): number {
  if (viewport.width <= 0) return viewport.visibleStart
  const time =
    viewport.visibleStart +
    (x / viewport.width) * (viewport.visibleEnd - viewport.visibleStart)
  return clamp(time, 0, viewport.maximumVisibleSpan)
}

export function getViewportVirtualWidth(
  viewport: TimelineViewportSnapshot,
): number {
  const span = viewport.visibleEnd - viewport.visibleStart
  if (span <= 0) return viewport.width
  return Math.max(viewport.width, (viewport.contentEnd / span) * viewport.width)
}

export function getViewportScrollLeft(
  viewport: TimelineViewportSnapshot,
): number {
  const span = viewport.visibleEnd - viewport.visibleStart
  if (viewport.contentEnd <= 0 || span >= viewport.contentEnd) return 0
  return (
    (viewport.visibleStart / viewport.contentEnd) *
    getViewportVirtualWidth(viewport)
  )
}

export function scrollLeftToVisibleStart(
  scrollLeft: number,
  viewport: TimelineViewportSnapshot,
): number {
  const virtualWidth = getViewportVirtualWidth(viewport)
  if (virtualWidth <= 0) return 0
  const span = viewport.visibleEnd - viewport.visibleStart
  if (span >= viewport.contentEnd) return 0
  return clamp(
    (scrollLeft / virtualWidth) * viewport.contentEnd,
    0,
    Math.max(0, viewport.contentEnd - span),
  )
}

export function timeToViewportSurfaceX(
  time: number,
  viewport: TimelineViewportSnapshot,
): number {
  const span = viewport.visibleEnd - viewport.visibleStart
  const surfaceEnd = Math.max(viewport.contentEnd, span)
  if (surfaceEnd <= 0) return 0
  return (time / surfaceEnd) * getViewportVirtualWidth(viewport)
}

function snapshotsAreEqual(
  left: TimelineViewportSnapshot,
  right: TimelineViewportSnapshot,
): boolean {
  return (
    nearlyEqual(left.visibleStart, right.visibleStart) &&
    nearlyEqual(left.visibleEnd, right.visibleEnd) &&
    nearlyEqual(left.duration, right.duration) &&
    nearlyEqual(left.contentEnd, right.contentEnd) &&
    nearlyEqual(left.maximumVisibleSpan, right.maximumVisibleSpan) &&
    nearlyEqual(left.fps, right.fps) &&
    nearlyEqual(left.width, right.width) &&
    left.mode === right.mode
  )
}

function assertDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('La duración del viewport debe ser mayor que cero')
  }
}

function normalizeContentEnd(duration: number, contentEnd: number): number {
  assertPositiveFinite(contentEnd, 'El final del contenido')
  return Math.max(duration, contentEnd)
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} debe ser mayor que cero`)
  }
}

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('Los FPS del viewport deben ser mayores que cero')
  }
}

function normalizeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(1, width) : 1
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9
}
