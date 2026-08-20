import {getProject, types, val} from '@theatre/core'
import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {Timeline411} from '../src/timeline411/timeline'

describe('compatibilidad Theatre.js 0.7.2', () => {
  it('carga directamente el JSON exportado, sin adaptador', async () => {
    const timeline = new Timeline411(projectState)
    timeline.store.transaction('Editar antes de exportar', (transaction) => {
      transaction.setLength('Animated scene', 4)
    })
    const exportedState = JSON.parse(timeline.stringify())

    const project = getProject(`K411-${Date.now().toString(36)}`, {
      state: exportedState,
    })
    const sheet = project.sheet('Animated scene')
    const object = sheet.object('Torus Knot', {
      rotation: types.compound({
        x: types.number(0),
        y: types.number(0),
        z: types.number(0),
      }),
      wireframe: false,
    })

    await project.ready
    sheet.sequence.position = 3

    expect(val(sheet.sequence.pointer.length)).toBe(4)
    expect(object.value.rotation).toMatchObject({x: 1, y: 1, z: 1})
    expect(object.value.wireframe).toBe(true)
    timeline.dispose()
  })
})
