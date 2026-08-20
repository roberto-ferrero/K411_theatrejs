import * as THREE from 'three'

export interface ThreeSceneContext {
  readonly torusKnot: THREE.Mesh<
    THREE.TorusKnotGeometry,
    THREE.MeshStandardMaterial
  >
  readonly material: THREE.MeshStandardMaterial
  dispose(): void
}

export function createThreeScene(container: HTMLElement): ThreeSceneContext {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(70, 1, 10, 200)
  camera.position.z = 50

  const geometry = new THREE.TorusKnotGeometry(10, 3, 300, 16)
  const material = new THREE.MeshStandardMaterial({
    color: '#049ef4',
    roughness: 0.5,
  })

  const torusKnot = new THREE.Mesh(geometry, material)
  torusKnot.name = 'Torus Knot'
  torusKnot.castShadow = true
  torusKnot.receiveShadow = true
  scene.add(torusKnot)

  const ambientLight = new THREE.AmbientLight('#ffffff', 0.5)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight('#ff0000', 30)
  directionalLight.position.y = 20
  directionalLight.position.z = 20
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.far = 50
  directionalLight.shadow.camera.near = 1
  directionalLight.shadow.camera.top = 20
  directionalLight.shadow.camera.right = 20
  directionalLight.shadow.camera.bottom = -20
  directionalLight.shadow.camera.left = -20
  scene.add(directionalLight)

  const rectAreaLight = new THREE.RectAreaLight('#ff0', 1, 50, 50)
  rectAreaLight.position.set(-20, -40, 10)
  rectAreaLight.lookAt(new THREE.Vector3(0, 0, 0))
  scene.add(rectAreaLight)

  const renderer = new THREE.WebGLRenderer({antialias: true})
  renderer.domElement.className = 'scene-canvas'
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  let animationFrame = 0
  const tick = (): void => {
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(tick)
  }
  tick()

  return {
    torusKnot,
    material,
    dispose(): void {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
