import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import type {SerializableMap} from '../src/timeline411/model'
import type {AnimationClock} from '../src/timeline411/player'
import {createTimeline, Timeline411} from '../src/timeline411/timeline'

class ManualClock implements AnimationClock {
  private time = 0
  private nextId = 1
  private readonly callbacks = new Map<number, (time: number) => void>()

  now(): number {
    return this.time
  }

  request(callback: (time: number) => void): number {
    const id = this.nextId++
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

describe('API Timeline 411', () => {
  it('aplica los valores evaluados a un binding y emite seek', () => {
    const timeline = new Timeline411(projectState)
    let applied: SerializableMap = {}
    let positions = 0
    timeline.bindObject(
      'Animated scene',
      'Torus Knot',
      {rotation: {x: 0, y: 0, z: 0}, wireframe: false},
      (value) => {
        applied = value
      },
    )
    timeline.on('sequence:position', () => {
      positions += 1
    })

    timeline.player.seek(3)

    expect(applied).toMatchObject({rotation: {x: 1, y: 1, z: 1}, wireframe: true})
    expect(positions).toBe(1)
    expect(JSON.parse(timeline.stringify()).definitionVersion).toBe('0.4.0')
    timeline.dispose()
  })

  it('emite los cues cruzados durante play, en orden, pero no durante seek', () => {
    const clock = new ManualClock()
    let id = 0
    const timeline = createTimeline({
      id: 'event-playback',
      clock,
      idFactory: (prefix) => `${prefix}_${++id}`,
    })
    timeline.composition('Scene')
    timeline.editor.transaction((transaction) => {
      transaction.setDuration('Scene', 3)
      const explosion = transaction.addEventFamily('Scene', 'Explosión')
      const camera = transaction.addEventFamily('Scene', 'Cambiar cámara')
      transaction.addEventCue(explosion, {position: 0, label: 'Inicio'})
      transaction.addEventCue(camera, {position: 0.5, payload: {camera: 'B'}})
      transaction.addEventCue(explosion, {position: 1, label: 'Impacto'})
      transaction.addEventCue(explosion, {position: 2.5})
    })

    const triggers: Array<{
      familyLabel: string
      label?: string
      position: number
      iteration: number
    }> = []
    timeline.on('event:trigger', ({familyLabel, label, position, iteration}) => {
      triggers.push({
        familyLabel,
        ...(label ? {label} : {}),
        position,
        iteration,
      })
    })

    timeline.player.seek(2)
    expect(triggers).toEqual([])
    timeline.player.seek(0)
    timeline.player.play({loop: false})
    clock.advance(1200)
    expect(triggers).toEqual([
      {familyLabel: 'Explosión', label: 'Inicio', position: 0, iteration: 0},
      {familyLabel: 'Cambiar cámara', position: 0.5, iteration: 0},
      {familyLabel: 'Explosión', label: 'Impacto', position: 1, iteration: 0},
    ])
    clock.advance(2200)
    expect(triggers.at(-1)).toEqual({
      familyLabel: 'Explosión',
      position: 2.5,
      iteration: 0,
    })
    expect(timeline.player.playing).toBe(false)
    timeline.dispose()
  })

  it('vuelve a emitir eventos en cada vuelta incluso con avances grandes', () => {
    const clock = new ManualClock()
    let id = 0
    const timeline = createTimeline({
      id: 'event-loop',
      clock,
      idFactory: (prefix) => `${prefix}_${++id}`,
    })
    timeline.composition('Scene')
    timeline.editor.transaction((transaction) => {
      transaction.setDuration('Scene', 2)
      const family = transaction.addEventFamily('Scene', 'Pulso')
      transaction.addEventCue(family, {position: 0})
      transaction.addEventCue(family, {position: 0.5})
    })
    const triggers: Array<{position: number; iteration: number}> = []
    timeline.on('event:trigger', ({position, iteration}) => {
      triggers.push({position, iteration})
    })

    timeline.player.play({loop: true})
    clock.advance(4500)
    expect(triggers).toEqual([
      {position: 0, iteration: 0},
      {position: 0.5, iteration: 0},
      {position: 0, iteration: 1},
      {position: 0.5, iteration: 1},
      {position: 0, iteration: 2},
      {position: 0.5, iteration: 2},
    ])
    expect(timeline.player.position).toBeCloseTo(0.5)
    timeline.dispose()
  })
})
