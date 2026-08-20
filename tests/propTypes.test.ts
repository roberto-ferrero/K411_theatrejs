import {describe, expect, it} from 'vitest'
import {encodePropertyPath} from '../src/timeline411/paths'
import {
  defaultValueFromSchema,
  interpolatorsFromSchema,
  normalizePropSchema,
  sanitizeValueWithSchema,
  types,
} from '../src/timeline411/propTypes'

describe('tipos de propiedades de Timeline 411', () => {
  it('normaliza shorthand y aplica defaults a compounds parciales', () => {
    const schema = normalizePropSchema({
      amount: 1,
      enabled: true,
      title: 'Torus',
      transform: {
        x: types.number(0, {range: [-10, 10]}),
        y: 2,
      },
      mode: types.stringLiteral('solid', {
        solid: 'Sólido',
        wireframe: 'Alambre',
      }),
    })

    expect(defaultValueFromSchema(schema)).toEqual({
      amount: 1,
      enabled: true,
      title: 'Torus',
      transform: {x: 0, y: 2},
      mode: 'solid',
    })
    expect(sanitizeValueWithSchema(schema, {transform: {x: 4}})).toEqual({
      amount: 1,
      enabled: true,
      title: 'Torus',
      transform: {x: 4, y: 2},
      mode: 'solid',
    })
  })

  it('expone interpoladores numéricos, discretos, RGBA y personalizados', () => {
    const schema = normalizePropSchema({
      amount: 0,
      enabled: false,
      color: types.rgba({r: 0, g: 0.2, b: 0.4, a: 1}),
      label: types.string('a', {
        interpolate: (left, right, progression) =>
          progression < 0.25 ? left : right,
      }),
    })
    const interpolators = interpolatorsFromSchema(schema)

    expect(interpolators[encodePropertyPath(['amount'])](0, 10, 0.5)).toBe(5)
    expect(interpolators[encodePropertyPath(['enabled'])](false, true, 0.5)).toBe(
      false,
    )
    expect(
      interpolators[encodePropertyPath(['color'])](
        {r: 0, g: 0, b: 0, a: 0},
        {r: 1, g: 0.5, b: 0.25, a: 1},
        0.5,
      ),
    ).toEqual({r: 0.5, g: 0.25, b: 0.125, a: 0.5})
    expect(interpolators[encodePropertyPath(['label'])]('a', 'b', 0.5)).toBe(
      'b',
    )
  })

  it('incluye los tipos de assets sin persistir datos ajenos al contrato', () => {
    const schema = normalizePropSchema({
      image: types.image('image-id'),
      file: types.file(),
    })

    expect(sanitizeValueWithSchema(schema, {
      image: {type: 'image', id: 'new-image', extra: 'ignored'},
      file: {type: 'file', id: 'document-id'},
    })).toEqual({
      image: {type: 'image', id: 'new-image'},
      file: {type: 'file', id: 'document-id'},
    })
  })
})
