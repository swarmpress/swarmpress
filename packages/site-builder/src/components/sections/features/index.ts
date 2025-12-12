/**
 * Feature Section Variants Registry
 * Maps variant names to their component file names
 */

export const FEATURE_SECTION_VARIANTS = {
  'simple': 'FeatureSimple',
  'simple-3x2-grid': 'FeatureSimple3x2Grid',
  'centered-2x2-grid': 'FeatureCentered2x2Grid',
  'offset-2x2-grid': 'FeatureOffset2x2Grid',
  'offset-with-feature-list': 'FeatureOffsetWithFeatureList',
  'three-column-with-large-icons': 'FeatureThreeColumnWithLargeIcons',
  'three-column-with-small-icons': 'FeatureThreeColumnWithSmallIcons',
  'with-product-screenshot': 'FeatureWithProductScreenshot',
  'with-product-screenshot-on-left': 'FeatureWithProductScreenshotOnLeft',
  'with-product-screenshot-panel': 'FeatureWithProductScreenshotPanel',
  'with-large-screenshot': 'FeatureWithLargeScreenshot',
  'with-large-bordered-screenshot': 'FeatureWithLargeBorderedScreenshot',
  'with-code-example-panel': 'FeatureWithCodeExamplePanel',
  'contained-in-panel': 'FeatureContainedInPanel',
  'with-testimonial': 'FeatureWithTestimonial',
} as const

export type FeatureSectionVariant = keyof typeof FEATURE_SECTION_VARIANTS
export const DEFAULT_FEATURE_VARIANT: FeatureSectionVariant = 'simple-3x2-grid'
