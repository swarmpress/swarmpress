/** Camera constants shared by the scene and pure tests (no Babylon imports). */

/** True isometric elevation: the camera looks down at atan(1/sqrt(2)) ≈ 35.26°. */
export const ISO_BETA = Math.PI / 2 - Math.atan(1 / Math.SQRT2)

/** Four 90° viewing angles (NE, SE, SW, NW of the target), like The Sims. */
export const ISO_ALPHAS = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4]

/** Default view: from the south-east, looking at the north and west walls. */
export const DEFAULT_FACING = 1

export const ZOOM_MIN = 3
export const ZOOM_MAX = 40

/** Orthographic frustum half-extents for a zoom level (metres) and aspect ratio. */
export function orthoExtents(zoom: number, aspect: number) {
  return { top: zoom, bottom: -zoom, left: -zoom * aspect, right: zoom * aspect }
}

/**
 * Half-height (metres) of an orthographic iso view that frames a building of
 * `width` x `depth` with walls `height` tall, from any of the four snapped
 * angles, at the given aspect ratio, with `margin` (fraction) to spare.
 * The footprint's diagonal spans (w+d)/sqrt2 horizontally; vertically it is
 * foreshortened by sin(elevation), and the walls add height*cos(elevation).
 */
export function fitZoom(width: number, depth: number, height: number, aspect: number, margin = 0.12): number {
  const elevation = Math.PI / 2 - ISO_BETA
  const span = (width + depth) / Math.SQRT2
  const halfV = (span * Math.sin(elevation) + height * Math.cos(elevation)) / 2
  const halfH = span / 2
  return clampZoom(Math.max(halfV, halfH / Math.max(aspect, 1e-3)) * (1 + margin))
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}
