import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import type {KeyframeAddress} from '../src/timeline411/model'
import {TimelineStore} from '../src/timeline411/store'
import {parseTheatreProjectState} from '../src/timeline411/validation'

const address: KeyframeAddress = {
  sheetId: 'Animated scene',
  objectKey: 'Torus Knot',
  trackId: 'Q9IUK1iBde',
  keyframeId: 'CFjUByQoGL',
}

function positionOf(store: TimelineStore): number {
  return store.document.sheetsById['Animated scene'].sequence?.tracksByObject[
    'Torus Knot'
  ].trackData.Q9IUK1iBde.keyframes.find(
    (keyframe) => keyframe.id === address.keyframeId,
  )?.position as number
}

describe('store Timeline 411', () => {
  it('agrupa un drag en una sola revisión y permite undo/redo', () => {
    const store = new TimelineStore(parseTheatreProjectState(projectState))
    const gesture = store.beginGesture('Mover keyframe')
    gesture.update((transaction) => transaction.updateKeyframe(address, {position: 1}))
    gesture.update((transaction) => transaction.updateKeyframe(address, {position: 1.5}))
    gesture.commit()

    expect(positionOf(store)).toBe(1.5)
    expect(store.revision).toBe(1)
    expect(store.history.undoLabel).toBe('Mover keyframe')
    expect(store.undo()).toBe(true)
    expect(positionOf(store)).toBe(0)
    expect(store.redo()).toBe(true)
    expect(positionOf(store)).toBe(1.5)
  })

  it('mantiene como máximo 50 IDs de revisión exportables', () => {
    const store = new TimelineStore(parseTheatreProjectState(projectState))
    for (let index = 1; index <= 55; index += 1) {
      store.transaction(`Duración ${index}`, (transaction) => {
        transaction.setLength('Animated scene', 3 + index / 10)
      })
    }

    expect(store.document.revisionHistory).toHaveLength(50)
    expect(new Set(store.document.revisionHistory).size).toBe(50)
  })

  it('edita una curva Bezier como un solo gesto reversible', () => {
    const store = new TimelineStore(parseTheatreProjectState(projectState))
    const gesture = store.beginGesture('Editar curva Bezier')
    gesture.update((transaction) => {
      transaction.setBezierInterpolation(address, [0.2, -0.4, 0.75, 1.35])
    })

    const track = store.document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData.Q9IUK1iBde
    expect(track?.keyframes[0].handles.slice(2)).toEqual([0.2, -0.4])
    expect(track?.keyframes[1].handles.slice(0, 2)).toEqual([0.75, 1.35])
    expect(store.revision).toBe(0)

    gesture.commit()
    expect(store.revision).toBe(1)
    expect(store.history.undoLabel).toBe('Editar curva Bezier')
    expect(store.undo()).toBe(true)
    expect(positionOf(store)).toBe(0)
  })

  it('rechaza controles temporales fuera de 0-1', () => {
    const store = new TimelineStore(parseTheatreProjectState(projectState))
    expect(() => store.transaction('Curva invalida', (transaction) => {
      transaction.setBezierInterpolation(address, [-0.1, 0, 0.8, 1])
    })).toThrow('x1 y x2')
  })
})
