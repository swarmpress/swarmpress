const eurFmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('en-IE')

export const eur = (n: number) => eurFmt.format(Math.round(n))
export const num = (n: number) => numFmt.format(Math.round(n))

/** €92.9k, €1.2M */
export function eurCompact(n: number) {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}€${(a / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${sign}€${(a / 1e3).toFixed(1)}k`
  return `${sign}€${numFmt.format(Math.round(a))}`
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** Absolute game minute → "Day 12 · 09:20" (days shown 1-based like the HUD). */
export function gameTime(minute: number) {
  const day = Math.floor(minute / 1440)
  const m = ((minute % 1440) + 1440) % 1440
  return `Day ${day + 1} · ${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** Wall time of a job in flight as a clock: "1:42", "12:05", "1:02:03". */
export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`
}

/** How long something took: "40 ms", "1.2 s", "48 s", then as a clock ("4:41"). */
export function duration(ms: number) {
  const a = Math.max(0, Math.round(ms))
  if (a < 1000) return `${a} ms`
  if (a < 10_000) return `${(a / 1000).toFixed(1)} s`
  if (a < 60_000) return `${Math.round(a / 1000)} s`
  return elapsed(a)
}

/** Minutes until a deadline → "2h 40m left" / "overdue by 20m". */
export function countdown(deltaMinutes: number) {
  const a = Math.abs(Math.round(deltaMinutes))
  const d = Math.floor(a / 1440)
  const h = Math.floor((a % 1440) / 60)
  const m = a % 60
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`
  return deltaMinutes >= 0 ? `${parts} left` : `overdue by ${parts}`
}

export const titleCase = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

export const sentence = (s: string) => {
  const t = s.replace(/[_-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string) {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Readable text colour (white or black, whichever contrasts more) for a background hex. */
export function textOn(hex: string) {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000'
}
