import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {evaluateSheet, evaluateTrack} from '../src/timeline411/evaluator'
import type {TheatreBasicKeyframedTrack} from '../src/timeline411/model'
import {
  InvalidTimelineDocumentError,
  parseTheatreProjectState,
} from '../src/timeline411/validation'

const linearTrack: TheatreBasicKeyframedTrack = {
  type: 'BasicKeyframedTrack',
  keyframes: [
    {
      id: 'left',
      value: 0,
      position: 0,
      handles: [0.5, 1, 0, 0],
      connectedRight: true,
    },
    {
      id: 'right',
      value: 10,
      position: 1,
      handles: [1, 1, 0.5, 0],
      connectedRight: true,
    },
  ],
}

describe('evaluador Timeline 411', () => {
  it('interpola valores numéricos y respeta los extremos', () => {
    expect(evaluateTrack(linearTrack, -1)).toBe(0)
    expect(evaluateTrack(linearTrack, 0.5)).toBeCloseTo(5, 5)
    expect(evaluateTrack(linearTrack, 2)).toBe(10)
  })

  it('mantiene el valor izquierdo en un segmento hold', () => {
    const holdTrack = JSON.parse(JSON.stringify(linearTrack)) as TheatreBasicKeyframedTrack
    holdTrack.keyframes[0].type = 'hold'
    expect(evaluateTrack(holdTrack, 0.75)).toBe(0)
  })

  it('evalúa el estado real por sheet, objeto y property path', () => {
    const document = parseTheatreProjectState(projectState)
    expect(
      evaluateSheet(document, 'Animated scene', 0).objects['Torus Knot'],
    ).toMatchObject({rotation: {x: 0, y: 0, z: 0}, wireframe: true})
    expect(
      evaluateSheet(document, 'Animated scene', 3).objects['Torus Knot'],
    ).toMatchObject({rotation: {x: 1, y: 1, z: 1}, wireframe: true})
  })

  it('rechaza valores ajenos al modelo serializable de Theatre.js', () => {
    const invalid = JSON.parse(JSON.stringify(projectState))
    invalid.sheetsById['Animated scene'].sequence.tracksByObject[
      'Torus Knot'
    ].trackData.Q9IUK1iBde.keyframes[0].value = [1, 2]

    expect(() => parseTheatreProjectState(invalid)).toThrow(
      InvalidTimelineDocumentError,
    )
  })
})
