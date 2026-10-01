/**
 * Pure time-of-day lighting model (no Babylon imports, unit-tested).
 * Input is the sim's minute of day; output is everything the renderer needs
 * to place and colour the sun/moon and the sky ambient.
 */

export type Rgb = { r: number; g: number; b: number }

export interface Daylight {
  /** Sun elevation in radians (negative = below horizon). */
  sunElevation: number
  /** Sun azimuth in radians, 0 = east, PI/2 = south, PI = west. */
  sunAzimuth: number
  /** Direct key light (sun by day, moon by night). */
  keyColor: Rgb
  keyIntensity: number
  /** Sky/ambient fill. */
  skyColor: Rgb
  groundColor: Rgb
  ambientIntensity: number
  /** Background clear colour seen through windows and around the building. */
  clearColor: Rgb
  /** 0 = full night, 1 = full day; drives automatic interior light needs. */
  daylightFactor: number
}

export const SUNRISE = 6 * 60
export const SUNSET = 20 * 60
const MAX_ELEVATION = (58 * Math.PI) / 180

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
})

const NOON_SUN: Rgb = { r: 1.0, g: 0.96, b: 0.9 }
const GOLDEN_SUN: Rgb = { r: 1.0, g: 0.55, b: 0.25 }
const MOON: Rgb = { r: 0.55, g: 0.65, b: 1.0 }
const DAY_SKY: Rgb = { r: 0.62, g: 0.74, b: 0.95 }
const DUSK_SKY: Rgb = { r: 0.85, g: 0.5, b: 0.45 }
const NIGHT_SKY: Rgb = { r: 0.06, g: 0.08, b: 0.16 }
const DAY_GROUND: Rgb = { r: 0.35, g: 0.3, b: 0.25 }
const NIGHT_GROUND: Rgb = { r: 0.03, g: 0.03, b: 0.05 }

export function daylight(minute: number): Daylight {
  const m = ((minute % 1440) + 1440) % 1440
  const dayT = (m - SUNRISE) / (SUNSET - SUNRISE) // 0 at sunrise, 1 at sunset
  const sunElevation = Math.sin(Math.PI * dayT) * MAX_ELEVATION
  const sunAzimuth = Math.PI * clamp01(dayT)
  const daylightFactor = smoothstep(-0.05, 0.25, Math.sin(Math.PI * dayT))
  // 0 near the horizon, 1 once the sun is well up.
  const height = smoothstep(0, 0.45, sunElevation / MAX_ELEVATION)

  const isDay = sunElevation > 0
  const keyColor = isDay ? mix(GOLDEN_SUN, NOON_SUN, height) : MOON
  const keyIntensity = isDay ? 0.6 + 2.4 * height : 0.25
  const twilight = isDay ? 1 - height : 0
  const skyDay = mix(DAY_SKY, DUSK_SKY, twilight * 0.8)
  const skyColor = mix(NIGHT_SKY, skyDay, daylightFactor)
  const groundColor = mix(NIGHT_GROUND, DAY_GROUND, daylightFactor)

  return {
    sunElevation,
    sunAzimuth,
    keyColor,
    keyIntensity,
    skyColor,
    groundColor,
    ambientIntensity: 0.12 + 0.55 * daylightFactor,
    clearColor: mix({ r: 0.02, g: 0.025, b: 0.05 }, mix(DAY_SKY, DUSK_SKY, twilight * 0.9), daylightFactor),
    daylightFactor,
  }
}

/** Unit vector pointing FROM the light TOWARDS the scene (Babylon convention), y up. */
export function keyLightDirection(d: Daylight): { x: number; y: number; z: number } {
  // By night the moon sits high in the south-west at a fixed angle.
  const elevation = d.sunElevation > 0 ? Math.max(d.sunElevation, 0.12) : 0.9
  const azimuth = d.sunElevation > 0 ? d.sunAzimuth : Math.PI * 0.7
  const x = Math.cos(azimuth) * Math.cos(elevation)
  const z = -Math.sin(azimuth) * Math.cos(elevation) // south = -z
  const y = Math.sin(elevation)
  return { x: -x, y: -y, z: -z }
}

export function formatClock(minute: number): string {
  const h = Math.floor(minute / 60)
  const mm = minute % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
