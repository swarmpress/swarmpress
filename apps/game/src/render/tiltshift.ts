/**
 * Tilt-shift (ADR-0086, the mockups' miniature look): the band across the
 * middle of the view stays sharp and the image blurs towards the top and
 * bottom, the way a macro lens sees a model on a table. One pass, a
 * golden-angle spiral of twelve taps whose radius grows with the distance
 * from the band. WGSL (WebGPU only, ADR-0064).
 */
import { Constants, PostProcess, ShaderLanguage, ShaderStore, type Camera } from '@babylonjs/core'

const NAME = 'swarmpressTiltShift'

const WGSL = `varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform texel: vec2f;
uniform strength: f32;
uniform band: f32;
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
  let d = abs(input.vUV.y - 0.5);
  let r = smoothstep(uniforms.band, 0.5, d) * uniforms.strength;
  var sum = vec3f(0.0);
  for (var i = 0; i < 12; i++) {
    let a = f32(i) * 2.39996;
    let rad = sqrt((f32(i) + 0.5) / 12.0) * r;
    let o = vec2f(cos(a), sin(a)) * rad * uniforms.texel;
    sum += textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + o, 0.0).rgb;
  }
  fragmentOutputs.color = vec4f(sum / 12.0, 1.0);
}`

/** Blur radius at the edges (CSS pixels) and the sharp band's half-height (share of the view). */
export const TILT_SHIFT = { strength: 7, band: 0.16 }

export function createTiltShift(camera: Camera): PostProcess {
  if (!ShaderStore.ShadersStoreWGSL[`${NAME}PixelShader`]) ShaderStore.ShadersStoreWGSL[`${NAME}PixelShader`] = WGSL
  const pp = new PostProcess('tilt-shift', NAME, {
    uniforms: ['texel', 'strength', 'band'],
    size: 1,
    camera,
    samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    shaderLanguage: ShaderLanguage.WGSL,
  })
  pp.onApply = (effect) => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    effect.setFloat2('texel', 1 / Math.max(1, pp.width), 1 / Math.max(1, pp.height))
    effect.setFloat('strength', TILT_SHIFT.strength * dpr)
    effect.setFloat('band', TILT_SHIFT.band)
  }
  return pp
}
