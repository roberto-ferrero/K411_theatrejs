import projectState from './state.json'
import type {ThreeSceneContext} from './scene'
import {createTimeline, Timeline411, Timeline411HtmlView} from './timeline411'

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
    rotation: {
      x: scene.torusKnot.rotation.x / Math.PI,
      y: scene.torusKnot.rotation.y / Math.PI,
      z: scene.torusKnot.rotation.z / Math.PI,
    },
    wireframe: scene.material.wireframe,
  })
  const unbind = torus.bind((values) => {
    scene.torusKnot.rotation.set(
      values.rotation.x * Math.PI,
      values.rotation.y * Math.PI,
      values.rotation.z * Math.PI,
    )
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
