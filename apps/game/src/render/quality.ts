/**
 * The renderer side of GPU sharing (ADR-0057 "Coexistence with Babylon",
 * FEAT-040): `RendererHooks` for the `GpuScheduler`. While the resident model
 * generates, the scene drops one quality tier (two at most), heavy
 * post-processing (SSAO, bloom) pauses, and frames are capped; afterwards the
 * tier the page started with comes back.
 *
 * Two WebGPU devices share one GPU here (Babylon on the main thread, the
 * engine in the worker). Fewer and cheaper frames are the renderer's lever;
 * the engine's own is its decode pipeline depth.
 */
import type { RendererHooks } from '../llm/gpu-scheduler'
import { QUALITY, type Quality, type QualitySettings } from './postfx'

/** Lowest first. */
export const QUALITY_TIERS: readonly Quality[] = ['low', 'medium', 'high']

export function isQuality(v: unknown): v is Quality {
  return typeof v === 'string' && (QUALITY_TIERS as readonly string[]).includes(v)
}

/** `levels` tiers below `base`, never below the lowest. */
export function dropTier(base: Quality, levels: number): Quality {
  const i = QUALITY_TIERS.indexOf(base)
  return QUALITY_TIERS[Math.max(0, i - Math.max(0, Math.floor(levels)))]
}

/** The settings with `levels` tiers dropped; any drop also pauses SSAO and bloom. */
export function qualityWithDrop(base: Quality, levels: number): QualitySettings {
  if (levels <= 0) return QUALITY[base]
  return { ...QUALITY[dropTier(base, levels)], ssao: false, bloom: false }
}

export interface QualityTarget {
  setQuality(q: QualitySettings): void
}

/** The scheduler's hooks onto a scene (`GameScene.setQuality`) and the render loop's frame cap. */
export function rendererHooks(target: QualityTarget, base: Quality, setFpsCap: (fps: number | null) => void): RendererHooks {
  return {
    setQualityDrop: (levels) => target.setQuality(qualityWithDrop(base, levels)),
    setFpsCap,
  }
}

/** Whether the render loop draws this frame under `fpsCap` (null: every frame). A millisecond of slack absorbs rAF jitter. */
export function frameDue(nowMs: number, lastDrawMs: number, fpsCap: number | null): boolean {
  return !fpsCap || nowMs - lastDrawMs >= 1000 / fpsCap - 1
}
