/**
 * Footer Section Variants Registry
 * Maps variant names to their component file names
 */

export const FOOTER_SECTION_VARIANTS = {
  '4-column-simple': 'FooterFourColumnSimple',
  '4-column-with-newsletter': 'FooterFourColumnWithNewsletter',
  '4-column-with-mission': 'FooterFourColumnWithMission',
  '4-column-with-cta': 'FooterFourColumnWithCTA',
  '4-column-with-newsletter-below': 'FooterFourColumnWithNewsletterBelow',
  'simple-centered': 'FooterSimpleCentered',
  'simple-with-social-links': 'FooterSimpleWithSocialLinks',
} as const

export type FooterSectionVariant = keyof typeof FOOTER_SECTION_VARIANTS
export const DEFAULT_FOOTER_VARIANT: FooterSectionVariant = 'simple-centered'
