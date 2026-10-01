import { Engine, WebGPUEngine, type AbstractEngine } from '@babylonjs/core'

export type RendererName = 'webgpu' | 'webgl2'

/**
 * WebGPU first, WebGL2 fallback (ADR-0004). `?renderer=webgl` forces the
 * fallback for testing and for users with broken drivers.
 */
export async function createEngine(canvas: HTMLCanvasElement, forceWebgl: boolean): Promise<{ engine: AbstractEngine; name: RendererName }> {
  if (!forceWebgl && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true })
      await engine.initAsync()
      return { engine, name: 'webgpu' }
    } catch (err) {
      console.warn('WebGPU init failed, falling back to WebGL2', err)
    }
  }
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true)
  return { engine, name: 'webgl2' }
}
