import {
  Camera,
  Color4,
  ColorCurves,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  SSAO2RenderingPipeline,
  Scene,
  type PostProcess,
} from '@babylonjs/core'
import { createTiltShift } from './tiltshift'

export type Quality = 'low' | 'medium' | 'high'

export interface QualitySettings {
  shadows: boolean
  shadowMapSize: number
  ssao: boolean
  bloom: boolean
  msaaSamples: number
  /** The miniature look (tilt-shift, ADR-0086); off on the low tier. */
  tiltShift?: boolean
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { shadows: false, shadowMapSize: 1024, ssao: false, bloom: false, msaaSamples: 1 },
  medium: { shadows: true, shadowMapSize: 2048, ssao: false, bloom: true, msaaSamples: 2, tiltShift: true },
  high: { shadows: true, shadowMapSize: 4096, ssao: true, bloom: true, msaaSamples: 4, tiltShift: true },
}

/**
 * ACES tone mapping, subtle bloom for screens and lamps, and SSAO for contact
 * shading so desks and shelves don't float (ADR-0006).
 */
export function createPostFx(scene: Scene, camera: Camera, quality: QualitySettings) {
  const pipeline = new DefaultRenderingPipeline('post', true, scene, [camera])
  pipeline.samples = quality.msaaSamples
  pipeline.fxaaEnabled = quality.msaaSamples <= 1
  pipeline.imageProcessingEnabled = true
  pipeline.imageProcessing.toneMappingEnabled = true
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  pipeline.imageProcessing.exposure = 1.1
  pipeline.imageProcessing.contrast = 1.1
  pipeline.bloomEnabled = quality.bloom
  pipeline.bloomThreshold = 0.85
  pipeline.bloomWeight = 0.25
  pipeline.bloomKernel = 48
  // Golden hour (ADR-0086): a warm grade and a soft vignette over the town.
  pipeline.imageProcessing.colorCurvesEnabled = true
  const curves = new ColorCurves()
  curves.globalHue = 38
  curves.globalDensity = 18
  curves.globalSaturation = 12
  curves.highlightsHue = 45
  curves.highlightsDensity = 12
  pipeline.imageProcessing.colorCurves = curves
  pipeline.imageProcessing.vignetteEnabled = true
  pipeline.imageProcessing.vignetteWeight = 1.4
  pipeline.imageProcessing.vignetteColor = new Color4(0.35, 0.22, 0.08, 0)

  let ssao: SSAO2RenderingPipeline | null = null
  if (quality.ssao && SSAO2RenderingPipeline.IsSupported) {
    ssao = new SSAO2RenderingPipeline('ssao', scene, 0.75, [camera])
    ssao.radius = 0.6
    ssao.totalStrength = 1.2
    ssao.samples = 16
    ssao.maxZ = 100
  }
  let ssaoOn = ssao !== null
  // The miniature look, after the pipeline (the last post-process on the camera).
  let tilt: PostProcess | null = quality.tiltShift ? createTiltShift(camera) : null
  return {
    pipeline,
    ssao,
    /**
     * Switch to `q` while the page runs (the GPU scheduler lowers the tier
     * while the local model generates, ADR-0057): bloom, MSAA and SSAO follow
     * it. SSAO can only come back if the configured tier created it.
     */
    apply(q: QualitySettings) {
      pipeline.samples = q.msaaSamples
      pipeline.fxaaEnabled = q.msaaSamples <= 1
      pipeline.bloomEnabled = q.bloom
      if (!!q.tiltShift !== !!tilt) {
        if (tilt) {
          tilt.dispose(camera)
          tilt = null
        } else tilt = createTiltShift(camera)
      }
      if (!ssao || q.ssao === ssaoOn) return
      const manager = scene.postProcessRenderPipelineManager
      if (q.ssao) manager.attachCamerasToRenderPipeline(ssao.name, camera)
      else manager.detachCamerasFromRenderPipeline(ssao.name, camera)
      ssaoOn = q.ssao
    },
  }
}
