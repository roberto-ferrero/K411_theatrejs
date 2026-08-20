import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {
  buildTimelineRows,
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
})
