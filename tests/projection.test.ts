import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {evaluateSheet} from '../src/timeline411/evaluator'
import {
  buildTimelineRows,
  projectTimelineRowValue,
  snapToFrame,
  timeToX,
  xToTime,
} from '../src/timeline411/projection'
import {parseTheatreProjectState} from '../src/timeline411/validation'

describe('proyección temporal', () => {
  it('convierte entre tiempo y píxeles sin perder el rango', () => {
    expect(timeToX(1.5, 3, 600)).toBe(300)
    expect(xToTime(300, 3, 600)).toBe(1.5)
    expect(xToTime(900, 3, 600)).toBe(3)
  })

  it('ajusta a frames y genera filas independientes del renderer', () => {
    expect(snapToFrame(1.017, 30)).toBe(1.033333)
    const rows = buildTimelineRows(
      parseTheatreProjectState(projectState),
      'Animated scene',
    )
    expect(rows.some((row) => row.kind === 'object' && row.label === 'Torus Knot')).toBe(
      true,
    )
    expect(rows.filter((row) => row.kind === 'track')).toHaveLength(3)
  })

  it('proyecta valores editables sólo en static overrides y keyframes', () => {
    const document = parseTheatreProjectState(projectState)
    const rows = buildTimelineRows(document, 'Animated scene')
    const x = rows.find(
      (row) => row.objectKey === 'Torus Knot' && row.path.join('.') === 'rotation.x',
    )
    const wireframe = rows.find(
      (row) => row.objectKey === 'Torus Knot' && row.path.join('.') === 'wireframe',
    )
    expect(x).toBeDefined()
    expect(wireframe).toBeDefined()

    const atKeyframe = projectTimelineRowValue(
      document,
      'Animated scene',
      x!,
      0,
      evaluateSheet(document, 'Animated scene', 0),
    )
    expect(atKeyframe).toMatchObject({
      mode: 'keyframe',
      value: 0,
      keyframe: {keyframeId: 'CFjUByQoGL'},
    })

    const interpolated = projectTimelineRowValue(
      document,
      'Animated scene',
      x!,
      1.5,
      evaluateSheet(document, 'Animated scene', 1.5),
    )
    expect(interpolated.mode).toBe('readonly')
    expect(typeof interpolated.value).toBe('number')

    const staticValue = projectTimelineRowValue(
      document,
      'Animated scene',
      wireframe!,
      1.5,
      evaluateSheet(document, 'Animated scene', 1.5),
    )
    expect(staticValue).toEqual({mode: 'static', value: true})
  })
})
