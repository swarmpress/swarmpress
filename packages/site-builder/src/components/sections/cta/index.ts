/**
 * CTA Section Components Registry
 * Maps variant names to CTA section components
 */

// Export all CTA components
export { default as CTASimpleCentered } from './CTASimpleCentered.astro'
export { default as CTASimpleStacked } from './CTASimpleStacked.astro'
export { default as CTASimpleJustified } from './CTASimpleJustified.astro'
export { default as CTACenteredOnDarkPanel } from './CTACenteredOnDarkPanel.astro'
export { default as CTASimpleCenteredOnBrand } from './CTASimpleCenteredOnBrand.astro'
export { default as CTASimpleCenteredWithGradient } from './CTASimpleCenteredWithGradient.astro'
export { default as CTASimpleJustifiedOnSubtleBrand } from './CTASimpleJustifiedOnSubtleBrand.astro'
export { default as CTASplitWithImage } from './CTASplitWithImage.astro'
export { default as CTADarkPanelWithAppScreenshot } from './CTADarkPanelWithAppScreenshot.astro'
export { default as CTATwoColumnsWithPhoto } from './CTATwoColumnsWithPhoto.astro'
export { default as CTAWithImageTiles } from './CTAWithImageTiles.astro'

// Variant mapping for ContentRenderer
export const CTA_SECTION_VARIANTS: Record<string, string> = {
  'simple-centered': 'CTASimpleCentered',
  'simple-stacked': 'CTASimpleStacked',
  'simple-justified': 'CTASimpleJustified',
  'centered-on-dark-panel': 'CTACenteredOnDarkPanel',
  'simple-centered-on-brand': 'CTASimpleCenteredOnBrand',
  'simple-centered-with-gradient': 'CTASimpleCenteredWithGradient',
  'simple-justified-on-subtle-brand': 'CTASimpleJustifiedOnSubtleBrand',
  'split-with-image': 'CTASplitWithImage',
  'dark-panel-with-app-screenshot': 'CTADarkPanelWithAppScreenshot',
  'two-columns-with-photo': 'CTATwoColumnsWithPhoto',
  'with-image-tiles': 'CTAWithImageTiles',
}

// Default variant
export const DEFAULT_CTA_VARIANT = 'simple-centered'
