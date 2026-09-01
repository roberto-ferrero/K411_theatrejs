import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {
  getEasingVisualDescriptor,
  getKeyframeEasingVisual,
  getSegmentEasingVisual,
  selectableEasingPresets,
} from '../src/timeline411/easingVisuals'
import {parseTheatreProjectState} from '../src/timeline411/validation'

describe('código visual de interpolaciones', () => {
  it('define una paleta única y patrones que no dependen sólo del color', () => {
    const visuals = selectableEasingPresets.map(getEasingVisualDescriptor)

    expect(visuals.map(({id}) => id)).toEqual([
      'linear',
      'hold',
      'ease',
      'easeIn',
      'easeOut',
      'easeInOut',
    ])
    expect(new Set(visuals.map(({color}) => color)).size).toBe(visuals.length)
    expect(getEasingVisualDescriptor('linear')).toMatchObject({
      color: '#a7b0be',
      kind: 'bezier',
      handles: [0, 0, 1, 1],
    })
    expect(getEasingVisualDescriptor('hold')).toMatchObject({
      color: '#f2b84b',
      kind: 'hold',
      dashArray: '4 3',
    })
    expect(getEasingVisualDescriptor('imported').dashArray).toBe('7 3 1.5 3')
  })

  it('reconoce una curva importada y la ausencia de segmento saliente', () => {
    const document = parseTheatreProjectState(projectState)
    const baseAddress = {
      sheetId: 'Animated scene',
      objectKey: 'Torus Knot',
      trackId: 'Q9IUK1iBde',
    }

    expect(getKeyframeEasingVisual(document, {
      ...baseAddress,
      keyframeId: 'CFjUByQoGL',
    })).toMatchObject({
      id: 'imported',
      handles: [0.645, 0.045, 0.355, 1],
    })
    expect(getKeyframeEasingVisual(document, {
      ...baseAddress,
      keyframeId: '6qCOzmWF9R',
    }).id).toBe('none')
  })

  it('clasifica presets y Hold desde los datos reales del segmento', () => {
    const document = parseTheatreProjectState(projectState)
    const track = document.sheetsById['Animated scene'].sequence
      ?.tracksByObject['Torus Knot'].trackData.Q9IUK1iBde
    if (!track) throw new Error('No se encontró el track x')
    const [left, right] = track.keyframes

    left.handles[2] = 0
    left.handles[3] = 0
    right.handles[0] = 1
    right.handles[1] = 1
    left.type = 'bezier'
    expect(getSegmentEasingVisual(left, right).id).toBe('linear')

    left.type = 'hold'
    expect(getSegmentEasingVisual(left, right).id).toBe('hold')
  })
})
