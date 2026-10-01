/**
 * Header Components
 * Export all header variants and provide resolution
 */

// Header variant types
export type HeaderVariant = 'simple' | 'mega-menu' | 'centered'

// Variant to component mapping (for dynamic resolution)
export const HEADER_VARIANTS: Record<HeaderVariant, string> = {
  simple: 'HeaderSimple',
  'mega-menu': 'HeaderMegaMenu',
  centered: 'HeaderCentered',
}

// Default variant
export const DEFAULT_HEADER_VARIANT: HeaderVariant = 'simple'
