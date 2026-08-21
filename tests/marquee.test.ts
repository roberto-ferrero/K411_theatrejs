import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {
  collectKeyframesInMarquee,
  normalizeTimelineMarqueeBounds,
} from '../src/timeline411/marquee'
import {buildTimelineRows} from '../src/timeline411/projection'
import {parseTheatreProjectState} from '../src/timeline411/validation'

describe('hit testing renderer-neutral de marquee', () => {
  it('normaliza arrastres en cualquier dirección', () => {
    expect(normalizeTimelineMarqueeBounds({
      timeStart: 3,
      timeEnd: 0,
      rowStart: 5,
      rowEnd: 2,
    })).toEqual({timeMin: 0, timeMax: 3, rowMin: 2, rowMax: 5})
    expect(() => normalizeTimelineMarqueeBounds({
      timeStart: Number.NaN,
      timeEnd: 0,
      rowStart: 0,
      rowEnd: 1,
    })).toThrow(/finitos/)
  })

  it('devuelve sólo keyframes reales cuyo tiempo y centro de fila están dentro', () => {
    const document = parseTheatreProjectState(projectState)
    const rows = buildTimelineRows(document, 'Animated scene')
    const selected = collectKeyframesInMarquee(
      document,
      'Animated scene',
      rows,
      {timeStart: 0.1, timeEnd: 0, rowStart: 4, rowEnd: 2},
    )

    expect(selected.map(({keyframeId}) => keyframeId)).toEqual([
      'CFjUByQoGL',
      'IXaZv1WgwK',
    ])
    expect(selected.every(({trackId}) => trackId.length > 0)).toBe(true)
  })
})
