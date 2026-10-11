// What the plastic reflects (FEAT-081, ADR-0085): a generated studio, as half floats WebGPU can
// filter, with the glints fading with the sky.
import { describe, expect, it } from 'vitest'
import { envIntensityFor, studioFaces, toHalf } from './environment'

describe('the plastic environment', () => {
  it('is a softbox overhead, a light horizon and a darker floor', () => {
    const size = 8
    const [, , top, bottom] = studioFaces(size)
    const centre = ((size / 2) * size + size / 2) * 4
    expect(top[centre]).toBeGreaterThan(2)
    expect(bottom[centre]).toBeLessThan(0.5)
    expect(bottom[centre]).toBeGreaterThan(0)
  })

  it('encodes half floats', () => {
    expect(toHalf(0)).toBe(0)
    expect(toHalf(1)).toBe(0x3c00)
    expect(toHalf(2)).toBe(0x4000)
    expect(toHalf(0.5)).toBe(0x3800)
    expect(toHalf(3)).toBe(0x4200)
  })

  it('fades with the sky', () => {
    expect(envIntensityFor(0.12)).toBeLessThan(envIntensityFor(0.67))
    expect(envIntensityFor(0)).toBe(0)
  })
})
