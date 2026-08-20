export interface AnimationClock {
  now(): number
  request(callback: (time: number) => void): number
  cancel(requestId: number): void
}

export interface PlaybackState {
  readonly position: number
  readonly playing: boolean
  readonly loop: boolean
}

type PlaybackListener = (state: PlaybackState) => void

export class TimelinePlayer {
  private positionValue = 0
  private playingValue = false
  private loopValue = true
  private previousClockTime = 0
  private requestId: number | undefined
  private readonly listeners = new Set<PlaybackListener>()

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
    }
  }

  subscribe(listener: PlaybackListener, emitCurrent = true): () => void {
    this.listeners.add(listener)
    if (emitCurrent) listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  play(options: {loop?: boolean} = {}): void {
    this.loopValue = options.loop ?? true
    if (this.playingValue) return
    const duration = this.getDuration()
    if (this.positionValue >= duration) this.positionValue = 0
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
  }

  private readonly tick = (clockTime: number): void => {
    if (!this.playingValue) return
    const duration = this.getDuration()
    const delta = Math.max(0, clockTime - this.previousClockTime) / 1000
    this.previousClockTime = clockTime
    let next = this.positionValue + delta

    if (next >= duration) {
      if (this.loopValue && duration > 0) next %= duration
      else {
        next = duration
        this.playingValue = false
      }
    }

    this.positionValue = next
    this.emit()
    if (this.playingValue) this.requestId = this.clock.request(this.tick)
    else this.requestId = undefined
  }

  private emit(): void {
    const snapshot = this.snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const browserAnimationClock: AnimationClock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (requestId) => cancelAnimationFrame(requestId),
}
