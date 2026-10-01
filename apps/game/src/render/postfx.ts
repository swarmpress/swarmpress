import {
  Camera,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  SSAO2RenderingPipeline,
  Scene,
} from '@babylonjs/core'

export type Quality = 'low' | 'medium' | 'high'

export interface QualitySettings {
  shadows: boolean
  shadowMapSize: number
  ssao: boolean
  bloom: boolean
  msaaSamples: number
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { shadows: false, shadowMapSize: 1024, ssao: false, bloom: false, msaaSamples: 1 },
  medium: { shadows: true, shadowMapSize: 2048, ssao: false, bloom: true, msaaSamples: 2 },
  high: { shadows: true, shadowMapSize: 4096, ssao: true, bloom: true, msaaSamples: 4 },
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

  let ssao: SSAO2RenderingPipeline | null = null
  if (quality.ssao && SSAO2RenderingPipeline.IsSupported) {
    ssao = new SSAO2RenderingPipeline('ssao', scene, 0.75, [camera])
    ssao.radius = 0.6
    ssao.totalStrength = 1.2
    ssao.samples = 16
    ssao.maxZ = 100
  }
  return { pipeline, ssao }
}
