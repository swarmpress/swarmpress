import { describe, expect, it } from 'vitest'
import { clockHands, wallTime } from './clock-math'

const TAU = Math.PI * 2

describe('wall clock', () => {
  it('reads the wall time in the HQ timezone', () => {
    // 2026-12-24 22:30:00 UTC is 23:30 in Rome (CET, UTC+1)
    const t = new Date(Date.UTC(2026, 11, 24, 22, 30, 0))
    expect(wallTime(t, 'Europe/Rome')).toEqual({ h: 23, m: 30, s: 0 })
    expect(wallTime(t, 'UTC')).toEqual({ h: 22, m: 30, s: 0 })
  })

  it('follows daylight saving time', () => {
    // 2026-07-01 10:00 UTC is 12:00 in Rome (CEST, UTC+2)
    expect(wallTime(new Date(Date.UTC(2026, 6, 1, 10, 0, 0)), 'Europe/Rome').h).toBe(12)
  })

  it('points the hands correctly', () => {
    const three = clockHands(new Date(Date.UTC(2026, 0, 1, 15, 0, 0)), 'UTC')
    expect(three.hour).toBeCloseTo(TAU / 4)
    expect(three.minute).toBeCloseTo(0)
    const half = clockHands(new Date(Date.UTC(2026, 0, 1, 6, 30, 0)), 'UTC')
    expect(half.minute).toBeCloseTo(TAU / 2)
    expect(half.hour).toBeCloseTo((6.5 / 12) * TAU)
  })
})
