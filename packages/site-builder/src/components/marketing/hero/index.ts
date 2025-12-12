/**
 * Hero Components
 * Export all hero variants and provide resolution
 */

// Hero variant types
export type HeroVariant = 'centered' | 'split' | 'simple' | 'with-app-screenshot'

// Hero button interface (matches HeroCentered.astro)
export interface HeroButton {
  text: string
  url: string
  variant: 'primary' | 'secondary' | 'outline' | 'ghost'
  external?: boolean
}

// Variant to component mapping (for dynamic resolution)
export const HERO_VARIANTS: Record<HeroVariant, string> = {
  centered: 'HeroCentered',
  split: 'HeroSplit',
  simple: 'HeroSimple',
  'with-app-screenshot': 'HeroWithAppScreenshot',
}

// Default variant
export const DEFAULT_HERO_VARIANT: HeroVariant = 'centered'
