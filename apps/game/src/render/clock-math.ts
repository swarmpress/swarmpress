/**
 * Real-time wall clock (living-people-and-the-real-world.md §5). Pure: given
 * an instant and an IANA timezone, return hand angles in radians, clockwise
 * from 12 o'clock.
 */
export interface ClockHands {
  hour: number
  minute: number
  second: number
}

export function wallTime(instant: Date, timeZone: string): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { h: get('hour'), m: get('minute'), s: get('second') }
}

export function clockHands(instant: Date, timeZone: string): ClockHands {
  const { h, m, s } = wallTime(instant, timeZone)
  const TAU = Math.PI * 2
  return {
    hour: (((h % 12) + m / 60 + s / 3600) / 12) * TAU,
    minute: ((m + s / 60) / 60) * TAU,
    second: (s / 60) * TAU,
  }
}
