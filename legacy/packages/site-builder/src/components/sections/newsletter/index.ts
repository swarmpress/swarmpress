/**
 * Newsletter Section Component Registry
 * Maps variant names to component paths
 */

export const NEWSLETTER_SECTION_VARIANTS: Record<string, string> = {
  'simple-stacked': 'NewsletterSimpleStacked',
  'simple-side-by-side': 'NewsletterSimpleSideBySide',
  'simple-side-by-side-on-brand': 'NewsletterSimpleSideBySideOnBrand',
  'centered-card': 'NewsletterCenteredCard',
  'side-by-side-on-card': 'NewsletterSideBySideOnCard',
  'side-by-side-with-details': 'NewsletterSideBySideWithDetails',
}

export default NEWSLETTER_SECTION_VARIANTS
