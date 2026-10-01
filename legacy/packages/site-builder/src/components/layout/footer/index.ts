/**
 * Footer Components
 * Export all footer variants and provide resolution
 */

// Footer variant types
export type FooterVariant = 'four-column' | 'simple' | 'centered'

// Variant to component mapping (for dynamic resolution)
export const FOOTER_VARIANTS: Record<FooterVariant, string> = {
  'four-column': 'FooterFourColumn',
  simple: 'FooterSimple',
  centered: 'FooterCentered',
}

// Default variant
export const DEFAULT_FOOTER_VARIANT: FooterVariant = 'four-column'
