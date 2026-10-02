import { describe, expect, it } from 'vitest'
import { clampZoom, fitZoom, ISO_BETA, orthoExtents, ZOOM_MAX, ZOOM_MIN } from './camera-math'

describe('camera math', () => {
  it('uses the true isometric elevation', () => {
    expect((90 - (ISO_BETA * 180) / Math.PI)).toBeCloseTo(35.264, 2)
  })

  it('keeps the aspect ratio in the ortho frustum', () => {
    const e = orthoExtents(10, 16 / 9)
    expect(e.right - e.left).toBeCloseTo((e.top - e.bottom) * (16 / 9))
  })

  it('clamps zoom', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(999)).toBe(ZOOM_MAX)
  })
})

describe('fitZoom', () => {
  it('frames bigger buildings with a larger view and respects the aspect ratio', () => {
    const small = fitZoom(18, 10, 3, 16 / 9)
    const big = fitZoom(36, 24, 3, 16 / 9)
    expect(big).toBeGreaterThan(small)
    expect(fitZoom(36, 24, 3, 0.5)).toBeGreaterThan(big) // portrait needs more height
  })
  it('the framed view contains the whole footprint diagonal horizontally', () => {
    const aspect = 16 / 9
    const z = fitZoom(36, 24, 3, aspect)
    expect(2 * z * aspect).toBeGreaterThanOrEqual((36 + 24) / Math.SQRT2)
  })
})
