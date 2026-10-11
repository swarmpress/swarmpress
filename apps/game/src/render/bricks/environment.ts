/**
 * What the plastic reflects (FEAT-081, ADR-0085): a soft studio around the
 * office, generated here (no downloaded asset), prefiltered once for PBR's
 * roughness levels. ABS bricks read as LEGO-like plastic by their glints;
 * without an environment PBR only shows the room lights' highlights.
 *
 * Bright overhead softbox, a light horizon, a warm grey floor. The office's
 * own light stays sim state (ADR-0006): `envIntensityFor` follows the sky's
 * intensity, so the glints fade at night.
 */
import { Constants, HDRFiltering, RawCubeTexture, type Scene } from '@babylonjs/core'

/** The environment's strength per unit of the sky light's intensity. */
export const ENV_PER_SKY = 0.4

/** RGBA floats for the six faces (+x, -x, +y, -y, +z, -z) of a `size` cube. */
export function studioFaces(size: number): Float32Array[] {
  const faces: Float32Array[] = []
  const dirs: Array<(u: number, v: number) => [number, number, number]> = [
    (u, v) => [1, -v, -u],
    (u, v) => [-1, -v, u],
    (u, v) => [u, 1, v],
    (u, v) => [u, -1, -v],
    (u, v) => [u, -v, 1],
    (u, v) => [-u, -v, -1],
  ]
  for (const dir of dirs) {
    const f = new Float32Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [dx, dy, dz] = dir(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1)
        const up = dy / Math.hypot(dx, dy, dz)
        // Floor 0.25 (warm), horizon 0.9, sky 1.0, a softbox overhead 3.0.
        let r: number, g: number, b: number
        if (up < 0) {
          const k = 0.25 + 0.65 * (1 + up)
          ;[r, g, b] = [k * 1.0, k * 0.96, k * 0.9]
        } else {
          const box = up > 0.85 ? 3 : 1
          const k = (0.9 + 0.1 * up) * box
          ;[r, g, b] = [k * 0.97, k * 0.99, k]
        }
        const o = (y * size + x) * 4
        f[o] = r
        f[o + 1] = g
        f[o + 2] = b
        f[o + 3] = 1
      }
    }
    faces.push(f)
  }
  return faces
}

/** IEEE half float bits of `v` (finite, non-negative inputs: the studio's radiance). */
export function toHalf(v: number): number {
  if (v <= 0) return 0
  const e = Math.floor(Math.log2(v))
  if (e < -14) return Math.round(v / 2 ** -24)
  const m = Math.round((v / 2 ** e - 1) * 1024)
  return ((Math.min(e + 15, 30) << 10) | (m === 1024 ? 1023 : m)) & 0x7fff
}

/** Sets the scene's environment to the studio; resolves once it is prefiltered. Fails soft (no glints). */
export async function plasticEnvironment(scene: Scene, size = 64): Promise<RawCubeTexture | null> {
  try {
    // Half floats: WebGPU filters them (32-bit float textures are not filterable).
    const faces = studioFaces(size).map((f) => Uint16Array.from(f, toHalf))
    const tex = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_HALF_FLOAT, true)
    await new HDRFiltering(scene.getEngine()).prefilter(tex)
    scene.environmentTexture = tex
    return tex
  } catch (e) {
    console.warn('[bricks] no plastic environment:', e)
    return null
  }
}

/** The environment's intensity for a sky light at `sky`. */
export const envIntensityFor = (sky: number) => ENV_PER_SKY * sky
