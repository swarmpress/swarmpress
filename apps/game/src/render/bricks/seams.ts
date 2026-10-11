/**
 * Brick seams (FEAT-081, ADR-0085): every brick face darkens towards its
 * edges, so a wall reads as courses of bricks and a desk as the parts it is
 * built from, the toy look the 1.6 mm gaps alone do not give at the
 * isometric camera's distance.
 *
 * A material plugin on the bricks' palette materials. The vertex stage passes
 * the template's local position (a unit box or cylinder centred on its
 * origin) and the instance's scale (the lengths of its world matrix's
 * columns, so thin instances work); the fragment stage takes, per axis, the
 * distance in metres to the box's face planes. The smallest is the face the
 * fragment lies on; the second smallest is the distance to the nearest edge,
 * and the albedo darkens over `width` metres from it.
 */
import { MaterialPluginBase, type Material, type UniformBuffer } from '@babylonjs/core'

/** Seam width (metres) and how dark the very edge gets (0 black, 1 no seam). */
export const SEAM_WIDTH = 0.006
export const SEAM_EDGE = 0.55

const VERTEX_WGSL = {
  CUSTOM_VERTEX_DEFINITIONS: `
varying vBrickLocal: vec3f;
varying vBrickScale: vec3f;
`,
  CUSTOM_VERTEX_MAIN_END: `
vertexOutputs.vBrickLocal = positionUpdated;
vertexOutputs.vBrickScale = vec3f(length(finalWorld[0].xyz), length(finalWorld[1].xyz), length(finalWorld[2].xyz));
`,
}

const FRAGMENT_WGSL = {
  CUSTOM_FRAGMENT_DEFINITIONS: `
varying vBrickLocal: vec3f;
varying vBrickScale: vec3f;
uniform brickSeam: vec4f;
`,
  CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
{
  let seamD = (vec3f(0.5) - abs(fragmentInputs.vBrickLocal)) * fragmentInputs.vBrickScale;
  let seamMin = min(seamD.x, min(seamD.y, seamD.z));
  let seamMax = max(seamD.x, max(seamD.y, seamD.z));
  let seamEdge = seamD.x + seamD.y + seamD.z - seamMin - seamMax;
  let seamK = mix(uniforms.brickSeam.y, 1.0, smoothstep(0.0, uniforms.brickSeam.x, seamEdge));
  surfaceAlbedo = surfaceAlbedo * seamK;
}
`,
}

const VERTEX_GLSL = {
  CUSTOM_VERTEX_DEFINITIONS: `
varying vec3 vBrickLocal;
varying vec3 vBrickScale;
`,
  CUSTOM_VERTEX_MAIN_END: `
vBrickLocal = positionUpdated;
vBrickScale = vec3(length(finalWorld[0].xyz), length(finalWorld[1].xyz), length(finalWorld[2].xyz));
`,
}

const FRAGMENT_GLSL = {
  CUSTOM_FRAGMENT_DEFINITIONS: `
varying vec3 vBrickLocal;
varying vec3 vBrickScale;
uniform vec4 brickSeam;
`,
  CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
{
  vec3 seamD = (vec3(0.5) - abs(vBrickLocal)) * vBrickScale;
  float seamMin = min(seamD.x, min(seamD.y, seamD.z));
  float seamMax = max(seamD.x, max(seamD.y, seamD.z));
  float seamEdge = seamD.x + seamD.y + seamD.z - seamMin - seamMax;
  surfaceAlbedo *= mix(brickSeam.y, 1.0, smoothstep(0.0, brickSeam.x, seamEdge));
}
`,
}

export class BrickSeamPlugin extends MaterialPluginBase {
  width = SEAM_WIDTH
  edge = SEAM_EDGE

  constructor(material: Material) {
    super(material, 'BrickSeam', 200, { BRICKSEAM: false })
    this._enable(true)
  }

  override isCompatible(): boolean {
    return true
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.BRICKSEAM = true
  }

  override getUniforms(): { ubo: Array<{ name: string; size: number; type: string }>; fragment: string } {
    return { ubo: [{ name: 'brickSeam', size: 4, type: 'vec4' }], fragment: '' }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4('brickSeam', this.width, this.edge, 0, 0)
  }

  override getClassName(): string {
    return 'BrickSeamPlugin'
  }

  override getCustomCode(shaderType: string, shaderLanguage = 0): { [pointName: string]: string } | null {
    const wgsl = shaderLanguage === 1
    if (shaderType === 'vertex') return wgsl ? VERTEX_WGSL : VERTEX_GLSL
    if (shaderType === 'fragment') return wgsl ? FRAGMENT_WGSL : FRAGMENT_GLSL
    return null
  }
}
