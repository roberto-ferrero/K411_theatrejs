import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import type {SerializableMap} from '../src/timeline411/model'
import {Timeline411} from '../src/timeline411/timeline'

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
})
