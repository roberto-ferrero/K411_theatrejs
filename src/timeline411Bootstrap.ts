import projectState from './state.json'
import type {ThreeSceneContext} from './scene'
import {
  createTimeline,
  registerTimelineObjectPropertyCatalog,
  Timeline411,
  Timeline411HtmlView,
  types,
} from './timeline411'

export interface Timeline411HtmlInstance {
  readonly timeline: Timeline411
  readonly view: Timeline411HtmlView
  dispose(): void
}

export function connectTimeline411Html(
  scene: ThreeSceneContext,
  container: HTMLElement,
): Timeline411HtmlInstance {
  const timeline = createTimeline({id: 'Torus demo', state: projectState})
  const composition = timeline.composition(timeline.firstSheetId)
  const torus = composition.object('Torus Knot', {
    position: types.compound({
      x: types.number(scene.torusKnot.position.x),
      y: types.number(scene.torusKnot.position.y),
      z: types.number(scene.torusKnot.position.z),
    }, {label: 'Posición'}),
    rotation: types.compound({
      x: types.number(scene.torusKnot.rotation.x / Math.PI),
      y: types.number(scene.torusKnot.rotation.y / Math.PI),
      z: types.number(scene.torusKnot.rotation.z / Math.PI),
    }, {label: 'Rotación'}),
    scale: types.compound({
      x: types.number(scene.torusKnot.scale.x),
      y: types.number(scene.torusKnot.scale.y),
      z: types.number(scene.torusKnot.scale.z),
    }, {label: 'Escala'}),
    visible: types.boolean(scene.torusKnot.visible, {label: 'Visible'}),
    material: types.compound({
      opacity: types.number(scene.material.opacity, {
        label: 'Opacidad',
        range: [0, 1],
      }),
    }, {label: 'Material'}),
    wireframe: types.boolean(scene.material.wireframe, {label: 'Wireframe'}),
  })
  registerTimelineObjectPropertyCatalog(torus, {
    objectType: 'three.mesh',
    properties: [
      {
        path: ['position'],
        label: 'Posición',
        category: 'Transformación',
        read: () => ({
          x: scene.torusKnot.position.x,
          y: scene.torusKnot.position.y,
          z: scene.torusKnot.position.z,
        }),
      },
      {
        path: ['rotation'],
        label: 'Rotación',
        category: 'Transformación',
        read: () => ({
          x: scene.torusKnot.rotation.x / Math.PI,
          y: scene.torusKnot.rotation.y / Math.PI,
          z: scene.torusKnot.rotation.z / Math.PI,
        }),
      },
      {
        path: ['scale'],
        label: 'Escala',
        category: 'Transformación',
        read: () => ({
          x: scene.torusKnot.scale.x,
          y: scene.torusKnot.scale.y,
          z: scene.torusKnot.scale.z,
        }),
      },
      {
        path: ['visible'],
        label: 'Visible',
        category: 'Objeto',
        read: () => scene.torusKnot.visible,
      },
      {
        path: ['material', 'opacity'],
        label: 'Opacidad (alpha)',
        category: 'Material',
        read: () => scene.material.opacity,
      },
      {
        path: ['wireframe'],
        label: 'Wireframe',
        category: 'Material',
        read: () => scene.material.wireframe,
      },
    ],
  })
  const unbind = torus.bind((values) => {
    scene.torusKnot.position.set(
      values.position.x,
      values.position.y,
      values.position.z,
    )
    scene.torusKnot.rotation.set(
      values.rotation.x * Math.PI,
      values.rotation.y * Math.PI,
      values.rotation.z * Math.PI,
    )
    scene.torusKnot.scale.set(
      values.scale.x,
      values.scale.y,
      values.scale.z,
    )
    scene.torusKnot.visible = values.visible
    const transparent = values.material.opacity < 1
    if (scene.material.transparent !== transparent) {
      scene.material.transparent = transparent
      scene.material.needsUpdate = true
    }
    scene.material.opacity = values.material.opacity
    scene.material.wireframe = values.wireframe
  })

  const view = new Timeline411HtmlView(timeline, composition.id)
  view.mount(container)
  composition.sequence.play({loop: true})

  return {
    timeline,
    view,
    dispose(): void {
      unbind()
      view.dispose()
      timeline.dispose()
    },
  }
}
