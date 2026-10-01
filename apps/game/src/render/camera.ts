import { ArcRotateCamera, Camera, PointerEventTypes, Scene, Vector3 } from '@babylonjs/core'

/** True isometric elevation: the camera looks down at atan(1/sqrt(2)) ≈ 35.26°. */
export const ISO_BETA = Math.PI / 2 - Math.atan(1 / Math.SQRT2)
/** Four 90° viewing angles, like The Sims / Two Point Hospital. */
export const ISO_ALPHAS = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4]

export interface IsoCamera {
  camera: ArcRotateCamera
  rotate(step: 1 | -1): void
  /** Index into ISO_ALPHAS; the cutaway uses it to pick which walls to hide. */
  facing(): number
}

/**
 * Orthographic isometric camera (ADR-0005). Fixed elevation, four snapped
 * rotations (Q/E), wheel zoom, drag to pan.
 */
export function createIsoCamera(scene: Scene, canvas: HTMLCanvasElement, target: Vector3): IsoCamera {
  const camera = new ArcRotateCamera('iso', ISO_ALPHAS[0], ISO_BETA, 60, target, scene)
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.1
  camera.maxZ = 200
  camera.inputs.clear()

  let zoom = 9 // half-height of the view in metres
  let facingIndex = 0
  let targetAlpha = camera.alpha

  const applyOrtho = () => {
    const engine = scene.getEngine()
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight())
    camera.orthoTop = zoom
    camera.orthoBottom = -zoom
    camera.orthoLeft = -zoom * aspect
    camera.orthoRight = zoom * aspect
  }
  applyOrtho()
  scene.getEngine().onResizeObservable.add(applyOrtho)

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoom = Math.min(20, Math.max(3, zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
      applyOrtho()
    },
    { passive: false },
  )

  let dragging = false
  scene.onPointerObservable.add((info) => {
    const ev = info.event as PointerEvent
    if (info.type === PointerEventTypes.POINTERDOWN) dragging = true
    else if (info.type === PointerEventTypes.POINTERUP) dragging = false
    else if (info.type === PointerEventTypes.POINTERMOVE && dragging) {
      const engine = scene.getEngine()
      const metresPerPixel = (2 * zoom) / engine.getRenderHeight()
      const right = camera.getDirection(Vector3.Right())
      const up = camera.getDirection(Vector3.Up())
      // Project screen axes onto the floor so panning slides along the ground.
      const flatRight = new Vector3(right.x, 0, right.z).normalize()
      const flatUp = new Vector3(up.x, 0, up.z).normalize()
      camera.target.addInPlace(flatRight.scale(-ev.movementX * metresPerPixel))
      camera.target.addInPlace(flatUp.scale((ev.movementY * metresPerPixel) / Math.sin(ISO_BETA)))
    }
  })

  // Smoothly animate rotation between the four snapped angles.
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000
    camera.alpha += (targetAlpha - camera.alpha) * Math.min(1, dt * 10)
  })

  return {
    camera,
    rotate(step) {
      facingIndex = (facingIndex + step + 4) % 4
      targetAlpha += (step * Math.PI) / 2
    },
    facing: () => facingIndex,
  }
}
