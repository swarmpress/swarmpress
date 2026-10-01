import { ArcRotateCamera, Camera, PointerEventTypes, Scene, Vector3 } from '@babylonjs/core'
import { clampZoom, DEFAULT_FACING, ISO_ALPHAS, ISO_BETA, orthoExtents } from './camera-math'

export interface IsoCamera {
  camera: ArcRotateCamera
  rotate(step: 1 | -1): void
  /** Index into ISO_ALPHAS. */
  facing(): number
  /** Jump to one of the four snapped angles (0..3). */
  setFacing(index: number): void
  /** Finish any rotation animation instantly (deterministic screenshots). */
  snap(): void
}

/**
 * Orthographic isometric camera (ADR-0005). Fixed elevation, four snapped
 * rotations (Q/E), wheel zoom, drag to pan.
 */
export function createIsoCamera(scene: Scene, canvas: HTMLCanvasElement | null, target: Vector3): IsoCamera {
  const camera = new ArcRotateCamera('iso', ISO_ALPHAS[DEFAULT_FACING], ISO_BETA, 60, target, scene)
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.1
  camera.maxZ = 200
  camera.inputs.clear()

  let zoom = 9 // half-height of the view in metres
  let facingIndex = DEFAULT_FACING
  let targetAlpha = camera.alpha

  const applyOrtho = () => {
    const engine = scene.getEngine()
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight())
    const e = orthoExtents(zoom, aspect)
    camera.orthoTop = e.top
    camera.orthoBottom = e.bottom
    camera.orthoLeft = e.left
    camera.orthoRight = e.right
  }
  applyOrtho()
  scene.getEngine().onResizeObservable.add(applyOrtho)

  canvas?.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoom = clampZoom(zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1))
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
    setFacing(index) {
      facingIndex = ((index % 4) + 4) % 4
      targetAlpha = ISO_ALPHAS[facingIndex]
    },
    snap() {
      camera.alpha = targetAlpha
    },
  }
}
