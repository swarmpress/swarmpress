/**
 * Hero Section Variants Registry
 * Maps variant names to component paths for dynamic loading
 */

export const HERO_SECTION_VARIANTS = {
  'simple-centered': 'HeroSimpleCentered',
  'simple-centered-with-background': 'HeroSimpleCenteredWithBackground',
  'split-with-image': 'HeroSplitWithImage',
  'with-app-screenshot': 'HeroWithAppScreenshot',
  'with-phone-mockup': 'HeroWithPhoneMockup',
  'with-image-tiles': 'HeroWithImageTiles',
  'with-offset-image': 'HeroWithOffsetImage',
  'with-angled-image': 'HeroWithAngledImage',
  // Future variants to implement:
  // 'split-with-screenshot': 'HeroSplitWithScreenshot',
  // 'split-with-bordered-screenshot': 'HeroSplitWithBorderedScreenshot',
  // 'split-with-code': 'HeroSplitWithCode',
  // 'with-bordered-app-screenshot': 'HeroWithBorderedAppScreenshot',
} as const

export type HeroSectionVariant = keyof typeof HERO_SECTION_VARIANTS

export const DEFAULT_HERO_VARIANT: HeroSectionVariant = 'simple-centered'

/**
 * Get the component name for a hero section variant
 */
export function getHeroComponentName(variant: string): string {
  return HERO_SECTION_VARIANTS[variant as HeroSectionVariant] || HERO_SECTION_VARIANTS[DEFAULT_HERO_VARIANT]
}

/**
 * Check if a variant is valid
 */
export function isValidHeroVariant(variant: string): variant is HeroSectionVariant {
  return variant in HERO_SECTION_VARIANTS
}

/**
 * Get all available hero section variants
 */
export function getHeroVariants(): HeroSectionVariant[] {
  return Object.keys(HERO_SECTION_VARIANTS) as HeroSectionVariant[]
}
