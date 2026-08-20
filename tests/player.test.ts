import {describe, expect, it} from 'vitest'
import type {AnimationClock} from '../src/timeline411/player'
import {TimelinePlayer} from '../src/timeline411/player'

class ManualClock implements AnimationClock {
  private time = 0
  private nextId = 1
  private readonly callbacks = new Map<number, (time: number) => void>()

  now(): number {
    return this.time
  }

  request(callback: (time: number) => void): number {
    const id = this.nextId
    this.nextId += 1
    this.callbacks.set(id, callback)
    return id
  }

  cancel(requestId: number): void {
    this.callbacks.delete(requestId)
  }

  advance(milliseconds: number): void {
    this.time += milliseconds
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback(this.time)
  }
}

describe('player Timeline 411', () => {
  it('reproduce, pausa al final y limita seek a la duración', () => {
    const clock = new ManualClock()
    const player = new TimelinePlayer(() => 2, clock)
    player.play({loop: false})
    clock.advance(500)
    expect(player.position).toBeCloseTo(0.5)
    clock.advance(2000)
    expect(player.position).toBe(2)
    expect(player.playing).toBe(false)
    player.seek(20)
    expect(player.position).toBe(2)
  })

  it('envuelve la posición cuando loop está activo', () => {
    const clock = new ManualClock()
    const player = new TimelinePlayer(() => 2, clock)
    player.play({loop: true})
    clock.advance(2500)
    expect(player.position).toBeCloseTo(0.5)
    expect(player.playing).toBe(true)
    player.dispose()
  })
})
