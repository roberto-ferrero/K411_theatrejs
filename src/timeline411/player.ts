export interface AnimationClock {
  now(): number
  request(callback: (time: number) => void): number
  cancel(requestId: number): void
}

export interface PlaybackState {
  readonly position: number
  readonly playing: boolean
  readonly loop: boolean
  readonly iteration: number
}

export interface PlaybackAdvanceSegment {
  readonly previousPosition: number
  readonly currentPosition: number
  readonly direction: 'forward' | 'reverse'
  readonly iteration: number
  readonly includeStart: boolean
}

type PlaybackAdvanceListener = (segment: PlaybackAdvanceSegment) => void

type PlaybackListener = (state: PlaybackState) => void

export class TimelinePlayer {
  private positionValue = 0
  private playingValue = false
  private loopValue = true
  private previousClockTime = 0
  private iterationValue = 0
  private includeStartOnNextAdvance = true
  private requestId: number | undefined
  private readonly listeners = new Set<PlaybackListener>()
  private readonly advanceListeners = new Set<PlaybackAdvanceListener>()

  constructor(
    private readonly getDuration: () => number,
    private readonly clock: AnimationClock = browserAnimationClock,
  ) {}

  get position(): number {
    return this.positionValue
  }

  get playing(): boolean {
    return this.playingValue
  }

  get snapshot(): PlaybackState {
    return {
      position: this.positionValue,
      playing: this.playingValue,
      loop: this.loopValue,
      iteration: this.iterationValue,
    }
  }

  subscribe(listener: PlaybackListener, emitCurrent = true): () => void {
    this.listeners.add(listener)
    if (emitCurrent) listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  subscribeAdvance(listener: PlaybackAdvanceListener): () => void {
    this.advanceListeners.add(listener)
    return () => this.advanceListeners.delete(listener)
  }

  play(options: {loop?: boolean} = {}): void {
    this.loopValue = options.loop ?? true
    if (this.playingValue) return
    const duration = this.getDuration()
    if (this.positionValue >= duration) {
      this.positionValue = 0
      this.iterationValue = 0
    }
    this.includeStartOnNextAdvance = this.positionValue === 0
    this.playingValue = true
    this.previousClockTime = this.clock.now()
    this.emit()
    this.requestId = this.clock.request(this.tick)
  }

  pause(): void {
    if (typeof this.requestId !== 'undefined') this.clock.cancel(this.requestId)
    this.requestId = undefined
    if (!this.playingValue) return
    this.playingValue = false
    this.emit()
  }

  seek(position: number): void {
    const duration = this.getDuration()
    const next = Math.max(0, Math.min(duration, position))
    if (next === this.positionValue) return
    this.positionValue = next
    this.emit()
  }

  clampToDuration(): void {
    const duration = this.getDuration()
    if (this.positionValue > duration) this.seek(duration)
  }

  dispose(): void {
    this.pause()
    this.listeners.clear()
    this.advanceListeners.clear()
  }

  private readonly tick = (clockTime: number): void => {
    if (!this.playingValue) return
    const duration = this.getDuration()
    const delta = Math.max(0, clockTime - this.previousClockTime) / 1000
    this.previousClockTime = clockTime
    const previous = this.positionValue
    const requested = previous + delta
    let next = requested
    const segments: PlaybackAdvanceSegment[] = []

    if (duration <= 0) {
      next = 0
      this.playingValue = false
    } else if (this.loopValue && requested >= duration) {
      const completedIterations = Math.floor(requested / duration)
      next = requested % duration
      segments.push({
        previousPosition: previous,
        currentPosition: duration,
        direction: 'forward',
        iteration: this.iterationValue,
        includeStart: this.includeStartOnNextAdvance,
      })
      for (let index = 1; index < completedIterations; index += 1) {
        this.iterationValue += 1
        segments.push({
          previousPosition: 0,
          currentPosition: duration,
          direction: 'forward',
          iteration: this.iterationValue,
          includeStart: true,
        })
      }
      this.iterationValue += 1
      segments.push({
        previousPosition: 0,
        currentPosition: next,
        direction: 'forward',
        iteration: this.iterationValue,
        includeStart: true,
      })
    } else {
      if (requested >= duration) {
        next = duration
        this.playingValue = false
      }
      if (next > previous || this.includeStartOnNextAdvance) {
        segments.push({
          previousPosition: previous,
          currentPosition: next,
          direction: 'forward',
          iteration: this.iterationValue,
          includeStart: this.includeStartOnNextAdvance,
        })
      }
    }

    this.includeStartOnNextAdvance = false
    this.positionValue = next
    this.emit()
    for (const segment of segments) this.emitAdvance(segment)
    if (this.playingValue) this.requestId = this.clock.request(this.tick)
    else this.requestId = undefined
  }

  private emit(): void {
    const snapshot = this.snapshot
    for (const listener of this.listeners) listener(snapshot)
  }

  private emitAdvance(segment: PlaybackAdvanceSegment): void {
    for (const listener of [...this.advanceListeners]) listener(segment)
  }
}

export const browserAnimationClock: AnimationClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (requestId) => cancelAnimationFrame(requestId),
}
