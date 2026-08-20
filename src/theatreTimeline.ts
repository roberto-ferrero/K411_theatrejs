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
    rotation: types.compound({
      x: types.number(scene.torusKnot.rotation.x, {range: [-2, 2]}),
      y: types.number(scene.torusKnot.rotation.y, {range: [-2, 2]}),
      z: types.number(scene.torusKnot.rotation.z, {range: [-2, 2]}),
    }),
    wireframe: scene.material.wireframe,
  })

  torusKnotObject.onValuesChange((values) => {
    const {x, y, z} = values.rotation
    scene.torusKnot.rotation.set(x * Math.PI, y * Math.PI, z * Math.PI)
    scene.material.wireframe = values.wireframe
  })

  await project.ready
  void sheet.sequence.play({iterationCount: Infinity})
}
