import {describe, expect, it} from 'vitest'
import {
  calculateScrubbedNumber,
  getNumberScrubStep,
} from '../src/timeline411/valueScrubbing'

describe('scrubbing numérico de Timeline 411', () => {
  it('aplica nudgeMultiplier y los modificadores fino y grueso', () => {
    expect(calculateScrubbedNumber({
      initialValue: 2,
      deltaPixels: 10,
      nudgeMultiplier: 0.5,
    })).toBe(7)
    expect(calculateScrubbedNumber({
      initialValue: 2,
      deltaPixels: 10,
      nudgeMultiplier: 0.5,
      fine: true,
    })).toBe(2.5)
    expect(calculateScrubbedNumber({
      initialValue: 2,
      deltaPixels: 10,
      nudgeMultiplier: 0.5,
      coarse: true,
    })).toBe(52)
    expect(calculateScrubbedNumber({
      initialValue: 2,
      deltaPixels: 10,
      nudgeMultiplier: 0.5,
      fine: true,
      coarse: true,
    })).toBe(2.5)
  })

  it('deriva la sensibilidad del rango y limita el resultado', () => {
    expect(getNumberScrubStep(0.5, {range: [0, 1]})).toBe(0.005)
    expect(calculateScrubbedNumber({
      initialValue: 0.5,
      deltaPixels: 200,
      range: [0, 1],
    })).toBe(1)
    expect(calculateScrubbedNumber({
      initialValue: 0.5,
      deltaPixels: -200,
      range: [0, 1],
    })).toBe(0)
  })

  it('usa un fallback proporcional y rechaza entradas inválidas', () => {
    expect(getNumberScrubStep(50)).toBe(0.5)
    expect(getNumberScrubStep(0)).toBe(0.01)
    expect(() => getNumberScrubStep(Number.NaN)).toThrow(/finito/)
    expect(() => getNumberScrubStep(1, {nudgeMultiplier: 0})).toThrow(
      /mayor que cero/,
    )
    expect(() => calculateScrubbedNumber({
      initialValue: 1,
      deltaPixels: 1,
      range: [2, 1],
    })).toThrow(/range/)
  })
})
