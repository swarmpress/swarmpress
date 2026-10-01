import { describe, expect, it } from 'vitest'
import { clampZoom, ISO_BETA, orthoExtents, ZOOM_MAX, ZOOM_MIN } from './camera-math'

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
