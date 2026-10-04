import { WebGPUEngine } from '@babylonjs/core'

/** The renderer is WebGPU only (ADR-0064); the name stays in the HUD and the test hook. */
export type RendererName = 'webgpu'

/** Why the page cannot draw: no WebGPU API, no adapter, a device that would not start, or one that kept dying. */
export type NoWebGpuReason = 'no-api' | 'no-adapter' | 'device-failed' | 'device-lost'

export class NoWebGpuError extends Error {
  constructor(
    readonly reason: NoWebGpuReason,
    readonly detail: string,
  ) {
    super(`WebGPU unavailable (${reason}): ${detail}`)
    this.name = 'NoWebGpuError'
  }
}

export interface DeviceLossInfo {
  reason: string
  message: string
}

interface DeviceLike {
  lost: Promise<{ reason: string; message: string }>
  destroy(): void
}

const deviceOf = (engine: WebGPUEngine) => (engine as unknown as { _device?: DeviceLike })._device ?? null

/**
 * A WebGPU engine on `canvas`, or a `NoWebGpuError` saying what is missing.
 *
 * Babylon's own context-loss handling is off (`doNotHandleContextLost`): its
 * in-place restore rebuilds buffers and pipelines before the new device exists,
 * so every resource stays tied to the dead one (docs/qualification/webgpu-headless.md).
 * A lost device is handled by `watchDeviceLoss` and a new engine instead.
 *
 * Probe with `navigator.gpu` only: `WebGPUEngine.IsSupportedAsync` would request
 * a second adapter for nothing.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<WebGPUEngine> {
  const gpu = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: unknown }).gpu
  if (!gpu) {
    const insecure = typeof window !== 'undefined' && !window.isSecureContext
    throw new NoWebGpuError('no-api', insecure ? 'the page is not a secure context (https or localhost), so navigator.gpu is hidden' : 'navigator.gpu is missing')
  }
  const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true, doNotHandleContextLost: true })
  try {
    await engine.initAsync()
  } catch (err) {
    try {
      engine.dispose()
    } catch {
      // A half-initialised engine cannot always dispose (Babylon reads members initAsync never set).
    }
    const detail = String(err instanceof Error ? err.message : err)
    // Babylon throws this string when requestAdapter() resolves to null.
    throw new NoWebGpuError(/adapter is null/i.test(detail) ? 'no-adapter' : 'device-failed', detail)
  }
  return engine
}

/**
 * Calls `onLost` once when the engine's device is lost, unless the engine was
 * disposed through the returned handle first. The handle also destroys the
 * device on purpose (the e2e test of the recovery).
 */
export function watchDeviceLoss(engine: WebGPUEngine, onLost: (info: DeviceLossInfo) => void): { dispose(): void; destroyDevice(): void } {
  let disposed = false
  const device = deviceOf(engine)
  device?.lost.then((info) => {
    if (!disposed) onLost({ reason: info.reason, message: info.message })
  })
  return {
    dispose() {
      disposed = true
      engine.dispose()
    },
    destroyDevice() {
      device?.destroy()
    },
  }
}
