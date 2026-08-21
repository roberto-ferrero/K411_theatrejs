import projectState from './state.json'
import type {ThreeSceneContext} from './scene'

export async function connectTheatreTimeline(
  scene: ThreeSceneContext,
): Promise<void> {
  // Theatre Studio verifies that Core has already been evaluated before it is
  // imported and initialized, so these dynamic imports must remain sequential.
  const {getProject, types} = await import('@theatre/core')

  if (import.meta.env.DEV) {
    const {default: studio} = await import('@theatre/studio')
    studio.initialize()
  }

  const project = getProject('THREE.js x Theatre.js', {state: projectState})
  const sheet = project.sheet('Animated scene')

  const torusKnotObject = sheet.object('Torus Knot', {
    position: types.compound({
      x: types.number(scene.torusKnot.position.x),
      y: types.number(scene.torusKnot.position.y),
      z: types.number(scene.torusKnot.position.z),
    }),
    rotation: types.compound({
      x: types.number(scene.torusKnot.rotation.x / Math.PI, {range: [-2, 2]}),
      y: types.number(scene.torusKnot.rotation.y / Math.PI, {range: [-2, 2]}),
      z: types.number(scene.torusKnot.rotation.z / Math.PI, {range: [-2, 2]}),
    }),
    scale: types.compound({
      x: types.number(scene.torusKnot.scale.x),
      y: types.number(scene.torusKnot.scale.y),
      z: types.number(scene.torusKnot.scale.z),
    }),
    visible: scene.torusKnot.visible,
    material: types.compound({
      opacity: types.number(scene.material.opacity, {range: [0, 1]}),
    }),
    wireframe: scene.material.wireframe,
  })

  torusKnotObject.onValuesChange((values) => {
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

  await project.ready
  void sheet.sequence.play({iterationCount: Infinity})
}
