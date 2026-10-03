// The renderer hooks of the GPU scheduler (FEAT-040, ADR-0057): the scene's
// tier drops while the model generates and comes back after the cooldown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuScheduler } from '../llm/gpu-scheduler'
import { QUALITY, type QualitySettings } from './postfx'
import { dropTier, frameDue, isQuality, qualityWithDrop, rendererHooks } from './quality'

describe('quality tiers', () => {
  it('drop one tier at a time and never below low', () => {
    expect(dropTier('high', 1)).toBe('medium')
    expect(dropTier('high', 2)).toBe('low')
    expect(dropTier('medium', 5)).toBe('low')
    expect(dropTier('low', 1)).toBe('low')
    expect(dropTier('medium', 0)).toBe('medium')
    expect(isQuality('medium')).toBe(true)
    expect(isQuality('ultra')).toBe(false)
  })

  it('any drop pauses the heavy post-processing; no drop is the configured tier exactly', () => {
    expect(qualityWithDrop('high', 0)).toBe(QUALITY.high)
    expect(qualityWithDrop('high', 1)).toEqual({ ...QUALITY.medium, ssao: false, bloom: false })
    // Already at low: the drop still turns bloom and SSAO off (they are off at low anyway).
    expect(qualityWithDrop('low', 1)).toEqual({ ...QUALITY.low, ssao: false, bloom: false })
  })

  it('caps frames by wall time', () => {
    expect(frameDue(100, 0, null)).toBe(true)
    expect(frameDue(20, 0, 30)).toBe(false)
    expect(frameDue(33, 0, 30)).toBe(true)
  })
})

describe('rendererHooks under the GpuScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lowers the scene while a generation runs and restores it after the cooldown', () => {
    const applied: QualitySettings[] = []
    const caps: (number | null)[] = []
    const scheduler = new GpuScheduler(rendererHooks({ setQuality: (q) => applied.push(q) }, 'high', (fps) => caps.push(fps)), { restoreDelayMs: 1500 })
    scheduler.begin('call-1')
    expect(applied).toEqual([{ ...QUALITY.medium, ssao: false, bloom: false }])
    expect(caps).toEqual([30])
    scheduler.end('call-1')
    // Back-to-back calls do not flicker: still lowered during the cooldown.
    vi.advanceTimersByTime(1000)
    expect(applied).toHaveLength(1)
    vi.advanceTimersByTime(600)
    expect(applied.at(-1)).toBe(QUALITY.high)
    expect(caps.at(-1)).toBeNull()
  })
})
