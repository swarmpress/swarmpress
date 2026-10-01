/**
 * Content Section Component Registry
 * Maps variant names to component paths
 */

export const CONTENT_SECTION_VARIANTS: Record<string, string> = {
  'centered': 'ContentCentered',
  'split-with-image': 'ContentSplitWithImage',
  'two-columns-with-screenshot': 'ContentTwoColumnsWithScreenshot',
  'with-image-tiles': 'ContentWithImageTiles',
  'with-sticky-product-screenshot': 'ContentWithStickyProductScreenshot',
  'with-testimonial-and-stats': 'ContentWithTestimonialAndStats',
  'with-testimonial': 'ContentWithTestimonial',
}

export default CONTENT_SECTION_VARIANTS
