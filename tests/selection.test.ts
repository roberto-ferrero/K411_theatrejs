import {describe, expect, it} from 'vitest'
import type {KeyframeAddress} from '../src/timeline411/model'
import {TimelineKeyframeSelection} from '../src/timeline411/selection'

const first: KeyframeAddress = {
  sheetId: 'Scene', objectKey: 'Cube', trackId: 'x', keyframeId: 'first',
}
const second: KeyframeAddress = {
  sheetId: 'Scene', objectKey: 'Cube', trackId: 'y', keyframeId: 'second',
}
const third: KeyframeAddress = {
  sheetId: 'Scene', objectKey: 'Cube', trackId: 'z', keyframeId: 'third',
}

describe('selección renderer-neutral de keyframes', () => {
  it('reemplaza la selección y mantiene el alias principal', () => {
    const selection = new TimelineKeyframeSelection()
    expect(selection.replace(first)).toBe(true)
    expect(selection.snapshot).toEqual({selection: first, selections: [first]})
    expect(selection.replace(first)).toBe(false)
    expect(selection.replace(second)).toBe(true)
    expect(selection.snapshot).toEqual({selection: second, selections: [second]})
  })

  it('alterna elementos conservando orden y usa el último como principal', () => {
    const selection = new TimelineKeyframeSelection()
    selection.toggle(first)
    selection.toggle(second)
    selection.toggle(third)
    expect(selection.snapshot).toEqual({
      selection: third,
      selections: [first, second, third],
    })
    selection.toggle(third)
    expect(selection.snapshot).toEqual({
      selection: second,
      selections: [first, second],
    })
  })

  it('reemplaza o amplía lotes sin duplicar direcciones', () => {
    const selection = new TimelineKeyframeSelection()
    expect(selection.replaceMany([first, second, first])).toBe(true)
    expect(selection.snapshot).toEqual({
      selection: second,
      selections: [first, second],
    })
    expect(selection.replaceMany([first, second])).toBe(false)
    expect(selection.addMany([second, third])).toBe(true)
    expect(selection.snapshot).toEqual({
      selection: third,
      selections: [first, second, third],
    })
    expect(selection.addMany([])).toBe(false)
  })

  it('cambia el principal sin alterar el grupo', () => {
    const selection = new TimelineKeyframeSelection()
    selection.toggle(first)
    selection.toggle(second)
    expect(selection.makePrimary(first)).toBe(true)
    expect(selection.snapshot).toEqual({
      selection: first,
      selections: [first, second],
    })
    expect(selection.makePrimary(third)).toBe(false)
  })

  it('descarta direcciones inexistentes y elige un principal válido', () => {
    const selection = new TimelineKeyframeSelection()
    selection.toggle(first)
    selection.toggle(second)
    selection.toggle(third)
    expect(selection.retain(({trackId}) => trackId !== 'z')).toBe(true)
    expect(selection.snapshot).toEqual({
      selection: second,
      selections: [first, second],
    })
    expect(selection.clear()).toBe(true)
    expect(selection.snapshot).toEqual({selection: undefined, selections: []})
  })
})
