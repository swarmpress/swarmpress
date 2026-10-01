import { describe, expect, it } from 'vitest'
import { daylight, formatClock, keyLightDirection } from './daylight'

describe('daylight', () => {
  it('peaks around 13:00 and is below the horizon at night', () => {
    expect(daylight(13 * 60).sunElevation).toBeGreaterThan(daylight(9 * 60).sunElevation)
    expect(daylight(23 * 60).sunElevation).toBeLessThan(0)
    expect(daylight(3 * 60).daylightFactor).toBe(0)
    expect(daylight(13 * 60).daylightFactor).toBe(1)
  })

  it('is warm at golden hour and neutral at noon', () => {
    const golden = daylight(19 * 60 + 15).keyColor
    const noon = daylight(13 * 60).keyColor
    expect(golden.r - golden.b).toBeGreaterThan(0.4)
    expect(noon.r - noon.b).toBeLessThan(0.15)
  })

  it('is dim at night', () => {
    const night = daylight(23 * 60 + 30)
    expect(night.keyIntensity).toBeLessThan(0.5)
    expect(night.ambientIntensity).toBeLessThan(0.2)
  })

  it('light always points downwards', () => {
    for (let m = 0; m < 1440; m += 30) expect(keyLightDirection(daylight(m)).y).toBeLessThan(0)
  })

  it('formats the clock', () => {
    expect(formatClock(7 * 60 + 5)).toBe('07:05')
    expect(formatClock(23 * 60 + 59)).toBe('23:59')
  })
})
