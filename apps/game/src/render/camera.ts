import { ArcRotateCamera, Camera, PointerEventTypes, Scene, Vector3 } from '@babylonjs/core'
import { clampZoom, DEFAULT_FACING, fitZoom, ISO_ALPHAS, ISO_BETA, orthoExtents } from './camera-math'

export interface IsoCamera {
  camera: ArcRotateCamera
  rotate(step: 1 | -1): void
  /** Index into ISO_ALPHAS. */
  facing(): number
  /** Jump to one of the four snapped angles (0..3). */
  setFacing(index: number): void
  /** Finish any rotation animation instantly (deterministic screenshots). */
  snap(): void
  /**
   * Glide to a rect on the floor (`x`, `z` its corner, metres) and zoom to fit
   * it and `h` of height: the shell's sections (ADR-0086). A drag or the wheel
   * takes over at once. `coveredRight` is the share of the view a panel
   * covers on the right: the rect is framed in what stays visible.
   */
  frame(rect: { x: number; z: number; w: number; d: number; h: number }, coveredRight?: number): void
}

/**
 * Orthographic isometric camera (ADR-0005). Fixed elevation, four snapped
 * rotations (Q/E), wheel zoom, drag to pan.
 */
export function createIsoCamera(
  scene: Scene,
  canvas: HTMLCanvasElement | null,
  target: Vector3,
  /** Building size to frame initially (`fitZoom`); omitted = the legacy fixed zoom. */
  frame?: { width: number; depth: number; height: number },
): IsoCamera {
  const camera = new ArcRotateCamera('iso', ISO_ALPHAS[DEFAULT_FACING], ISO_BETA, 60, target, scene)
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.minZ = 0.1
  camera.maxZ = 200
  camera.inputs.clear()

  const initialAspect = () => {
    const engine = scene.getEngine()
    return engine.getRenderWidth() / Math.max(1, engine.getRenderHeight())
  }
  // half-height of the view in metres
  let zoom = frame ? fitZoom(frame.width, frame.depth, frame.height, initialAspect()) : 9
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
      glide = null
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
      glide = null
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

  // A section's frame to glide to (target and zoom), until reached or the player moves the camera.
  let glide: { target: Vector3; zoom: number } | null = null
  // Smoothly animate rotation between the four snapped angles, and the glide.
  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000
    camera.alpha += (targetAlpha - camera.alpha) * Math.min(1, dt * 10)
    if (glide) {
      const k = Math.min(1, dt * 5)
      camera.target.addInPlace(glide.target.subtract(camera.target).scaleInPlace(k))
      zoom += (glide.zoom - zoom) * k
      applyOrtho()
      if (Vector3.Distance(camera.target, glide.target) < 0.01 && Math.abs(zoom - glide.zoom) < 0.01) glide = null
    }
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
    frame(r, coveredRight = 0) {
      const aspect = scene.getEngine().getRenderWidth() / Math.max(1, scene.getEngine().getRenderHeight())
      const share = Math.min(0.7, Math.max(0, coveredRight))
      const z = fitZoom(r.w, r.d, r.h, aspect * (1 - share))
      const target = new Vector3(r.x + r.w / 2, 0, r.z + r.d / 2)
      if (share > 0) {
        // Move the view right by half the covered width, so the rect sits in the visible part.
        const right = camera.getDirection(Vector3.Right())
        const flat = new Vector3(right.x, 0, right.z).normalize()
        target.addInPlace(flat.scale(share * z * aspect))
      }
      glide = { target, zoom: z }
    },
  }
}
