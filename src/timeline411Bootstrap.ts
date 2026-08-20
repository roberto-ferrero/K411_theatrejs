import projectState from './state.json'
import type {ThreeSceneContext} from './scene'
import {Timeline411, Timeline411HtmlView} from './timeline411'
import {isSerializableMap} from './timeline411/paths'

export interface Timeline411HtmlInstance {
  readonly timeline: Timeline411
  readonly view: Timeline411HtmlView
  dispose(): void
}

export function connectTimeline411Html(
  scene: ThreeSceneContext,
  container: HTMLElement,
): Timeline411HtmlInstance {
  const timeline = new Timeline411(projectState)
  const sheetId = timeline.firstSheetId
  const unbind = timeline.bindObject(
    sheetId,
    'Torus Knot',
    {
      rotation: {
        x: scene.torusKnot.rotation.x,
        y: scene.torusKnot.rotation.y,
        z: scene.torusKnot.rotation.z,
      },
      wireframe: scene.material.wireframe,
    },
    (values) => {
      const rotation = values.rotation
      if (isSerializableMap(rotation)) {
        scene.torusKnot.rotation.set(
          numberValue(rotation.x) * Math.PI,
          numberValue(rotation.y) * Math.PI,
          numberValue(rotation.z) * Math.PI,
        )
      }
      if (typeof values.wireframe === 'boolean') {
        scene.material.wireframe = values.wireframe
      }
    },
  )

  const view = new Timeline411HtmlView(timeline, sheetId)
  view.mount(container)
  timeline.player.play({loop: true})

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

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
