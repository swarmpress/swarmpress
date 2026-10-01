/**
 * Blog Section Component Registry
 * Maps variant names to component paths
 */

export const BLOG_SECTION_VARIANTS: Record<string, string> = {
  'single-column': 'BlogSingleColumn',
  'single-column-with-images': 'BlogSingleColumnWithImages',
  'three-column': 'BlogThreeColumn',
  'three-column-with-images': 'BlogThreeColumnWithImages',
  'three-column-with-background-images': 'BlogThreeColumnWithBackgroundImages',
  'with-featured-post': 'BlogWithFeaturedPost',
  'with-photo-and-list': 'BlogWithPhotoAndList',
}

export default BLOG_SECTION_VARIANTS
