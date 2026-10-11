/**
 * A shell's floor layer as one textured plane (FEAT-081, ADR-0085): the
 * kit's floor tiles (planks, checker squares, carpet, plain) painted into a
 * texture, a texel grid of `PX_PER_STUD` per stud, with a darker seam on
 * each tile's east and south edge so the planks still read as bricks. The
 * tiles are flat, studless and seen from above, so a plane looks the same
 * as thousands of boxes at a fraction of the vertices (software WebGPU in
 * CI draws the office at 2 fps with them, 16 without).
 *
 * Pure pixels first (`paintFloor`, tested without a GPU), then the mesh.
 */
import { Constants, MeshBuilder, PBRMaterial, RawTexture, Texture, type Mesh, type Scene } from '@babylonjs/core'
import type { FloorTile } from './chunk'
import { STUD } from './placements'

export const PX_PER_STUD = 4
/** Largest texture side; a larger floor gets fewer texels per stud. */
const MAX_SIDE = 2048
/** How much darker a seam is than its tile. */
const SEAM = 0.72

export interface FloorImage {
  /** World rect the texture covers. */
  x0: number
  z0: number
  x1: number
  z1: number
  width: number
  height: number
  /** RGBA, row 0 at the north edge (z0). */
  pixels: Uint8Array
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Paints the tiles (colour ids resolved by `hexOf`); null when there are none. */
export function paintFloor(tiles: readonly FloorTile[], hexOf: (colour: string) => string): FloorImage | null {
  if (!tiles.length) return null
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const t of tiles) {
    x0 = Math.min(x0, t.x0)
    z0 = Math.min(z0, t.z0)
    x1 = Math.max(x1, t.x1)
    z1 = Math.max(z1, t.z1)
  }
  const studsW = Math.round((x1 - x0) / STUD)
  const studsD = Math.round((z1 - z0) / STUD)
  const px = Math.max(1, Math.min(PX_PER_STUD, Math.floor(MAX_SIDE / Math.max(studsW, studsD))))
  const width = Math.max(1, studsW * px)
  const height = Math.max(1, studsD * px)
  const pixels = new Uint8Array(width * height * 4)
  const rgb = new Map<string, [number, number, number]>()
  for (const t of tiles) {
    let c = rgb.get(t.colour)
    if (!c) rgb.set(t.colour, (c = rgbOf(hexOf(t.colour))))
    const a = Math.round(((t.x0 - x0) / STUD) * px)
    const b = Math.round(((t.x1 - x0) / STUD) * px)
    const top = Math.round(((t.z0 - z0) / STUD) * px)
    const bottom = Math.round(((t.z1 - z0) / STUD) * px)
    for (let y = top; y < bottom; y++) {
      for (let x = a; x < b; x++) {
        const k = x === b - 1 || y === bottom - 1 ? SEAM : 1
        const o = (y * width + x) * 4
        pixels[o] = c[0] * k
        pixels[o + 1] = c[1] * k
        pixels[o + 2] = c[2] * k
        pixels[o + 3] = 255
      }
    }
  }
  return { x0, z0, x1, z1, width, height, pixels }
}

/** The floor as a ground plane at `top`, its texture painted from the tiles. */
export function floorMesh(scene: Scene, name: string, image: FloorImage, top: number): Mesh {
  const w = image.x1 - image.x0
  const d = image.z1 - image.z0
  const mesh = MeshBuilder.CreateGround(name, { width: w, height: d }, scene)
  mesh.position.set(image.x0 + w / 2, top, image.z0 + d / 2)
  mesh.isPickable = false
  const texture = new RawTexture(image.pixels, image.width, image.height, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  // A ground's v is 0 at its north edge (-z), where the raw upload's row 0 is.
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE
  const material = new PBRMaterial(`${name}-material`, scene)
  material.albedoTexture = texture
  material.metallic = 0
  material.roughness = 0.36
  mesh.material = material
  mesh.freezeWorldMatrix()
  return mesh
}
