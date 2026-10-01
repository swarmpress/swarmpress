/** Camera constants shared by the scene and pure tests (no Babylon imports). */

/** True isometric elevation: the camera looks down at atan(1/sqrt(2)) ≈ 35.26°. */
export const ISO_BETA = Math.PI / 2 - Math.atan(1 / Math.SQRT2)

/** Four 90° viewing angles (NE, SE, SW, NW of the target), like The Sims. */
export const ISO_ALPHAS = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4]

/** Default view: from the south-east, looking at the north and west walls. */
export const DEFAULT_FACING = 1

export const ZOOM_MIN = 3
export const ZOOM_MAX = 20

/** Orthographic frustum half-extents for a zoom level (metres) and aspect ratio. */
export function orthoExtents(zoom: number, aspect: number) {
  return { top: zoom, bottom: -zoom, left: -zoom * aspect, right: zoom * aspect }
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}
