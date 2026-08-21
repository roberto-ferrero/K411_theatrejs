import {describe, expect, it} from 'vitest'
import {
  getTimelineObjectPropertyCatalog,
  isTimelinePropertyActive,
  registerTimelineObjectPropertyCatalog,
} from '../src/timeline411/propertyCatalog'
import {types} from '../src/timeline411/propTypes'
import {createTimeline} from '../src/timeline411/timeline'

function createCatalogFixture() {
  const timeline = createTimeline({id: 'property-catalog'})
  const composition = timeline.composition('Scene')
  const object = composition.object('Cube', {
    position: types.compound({x: 0, y: 0, z: 0}, {label: 'Posición'}),
    visible: types.boolean(true, {label: 'Visible'}),
  })
  const host = {position: {x: 4, y: 5, z: 6}, visible: false}
  const catalog = registerTimelineObjectPropertyCatalog(object, {
    objectType: 'test.mesh',
    properties: [
      {
        path: ['position'],
        category: 'Transformación',
        read: () => ({...host.position}),
      },
      {
        path: ['visible'],
        category: 'Objeto',
        read: () => host.visible,
      },
    ],
  })
  return {timeline, object, catalog}
}

describe('catálogo renderer-neutral de propiedades', () => {
  it('activa una compound prop con el valor actual y una sola entrada de historial', () => {
    const {timeline, object, catalog} = createCatalogFixture()
    expect(catalog.objectType).toBe('test.mesh')
    expect(catalog.getAvailableEntries().map(({label}) => label)).toEqual([
      'Posición',
      'Visible',
    ])

    expect(catalog.activate('["position"]')).toBe(true)
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube.position,
    ).toEqual({x: 4, y: 5, z: 6})
    expect(isTimelinePropertyActive(timeline.document, object.props.position)).toBe(true)
    expect(timeline.store.history.undoLabel).toBe('Añadir propiedad Posición')
    expect(catalog.getAvailableEntries().map(({label}) => label)).toEqual([
      'Visible',
    ])
    expect(catalog.activate('["position"]')).toBe(false)

    expect(timeline.store.undo()).toBe(true)
    expect(
      timeline.document.sheetsById.Scene.staticOverrides.byObject.Cube.position,
    ).toBeUndefined()
    expect(catalog.getAvailableEntries()).toHaveLength(2)
    timeline.dispose()
  })

  it('registra el catálogo fuera del JSON y notifica cambios de configuración', () => {
    const timeline = createTimeline({id: 'catalog-events'})
    const composition = timeline.composition('Scene')
    const object = composition.object('Camera', {fov: 50})
    const events: Array<{sheetId: string; objectKey?: string}> = []
    timeline.on('object:configuration', (event) => events.push(event))
    registerTimelineObjectPropertyCatalog(object, {
      objectType: 'three.perspective-camera',
      properties: [{path: ['fov'], category: 'Cámara'}],
    })

    expect(getTimelineObjectPropertyCatalog(object)?.entries[0].label).toBe('fov')
    expect(events.at(-1)).toEqual({sheetId: 'Scene', objectKey: 'Camera'})
    expect(timeline.stringify()).not.toContain('three.perspective-camera')
    expect(timeline.stringify()).not.toContain('Cámara')
    timeline.dispose()
  })

  it('rechaza paths ausentes y definiciones duplicadas', () => {
    const timeline = createTimeline({id: 'invalid-catalog'})
    const object = timeline.composition('Scene').object('Cube', {visible: true})
    expect(() => registerTimelineObjectPropertyCatalog(object, {
      objectType: 'mesh',
      properties: [{path: ['opacity']}],
    })).toThrow(/no existe en el schema/)
    expect(() => registerTimelineObjectPropertyCatalog(object, {
      objectType: 'mesh',
      properties: [{path: ['visible']}, {path: ['visible']}],
    })).toThrow(/duplicado/)
    timeline.dispose()
  })
})
