import {getProject, types, val} from '@theatre/core'
import {describe, expect, it} from 'vitest'
import projectState from '../src/state.json'
import {Timeline411} from '../src/timeline411/timeline'
import {createTimeline} from '../src/timeline411/timeline'

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

  it('carga en Theatre.js un documento creado y editado con la API pública', async () => {
    let id = 0
    const timeline = createTimeline({
      id: 'generated-state',
      idFactory: (prefix) => `${prefix}_${++id}`,
    })
    const composition = timeline.composition('Generated scene')
    const sourceObject = composition.object('Cube', {x: 0, visible: true})

    timeline.editor.transaction((transaction) => {
      transaction.set(sourceObject.props.visible, false)
      transaction.sequence(sourceObject.props.x)
      transaction.setDuration(composition.id, 2)
    })
    composition.sequence.position = 2
    timeline.editor.transaction((transaction) => {
      transaction.set(sourceObject.props.x, 10)
    })

    const project = getProject(`K411-generated-${Date.now().toString(36)}`, {
      state: JSON.parse(timeline.stringify()),
    })
    const sheet = project.sheet('Generated scene')
    const object = sheet.object('Cube', {x: types.number(0), visible: true})
    await project.ready

    sheet.sequence.position = 1
    expect(val(sheet.sequence.pointer.length)).toBe(2)
    expect(object.value.x).toBeCloseTo(5)
    expect(object.value.visible).toBe(false)
    timeline.dispose()
  })
})
