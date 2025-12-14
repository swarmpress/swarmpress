/**
 * Section Registry
 *
 * Unified registry of all available section types and their variants.
 * Used by the Page Editor to display available sections and configure them.
 */

// ============================================================================
// Section Definition Types
// ============================================================================

export interface SectionVariant {
  id: string
  label: string
  description?: string
}

// Note: Named SectionTypeDefinition to avoid conflict with SectionDefinition in site-definition.ts
export interface SectionTypeDefinition {
  type: string
  label: string
  description: string
  icon: string // Lucide icon name
  category: SectionCategory
  variants: SectionVariant[]
  supportsCollections: boolean
  collectionTypes?: string[] // Which collections this section can bind to
  defaultVariant: string
}

export type SectionCategory =
  | 'layout' // Hero, Header, Footer
  | 'content' // Content, Features, Stats
  | 'social-proof' // Testimonials, Logo Cloud, Team
  | 'engagement' // CTA, Newsletter, Contact
  | 'information' // FAQ, Pricing, Blog
  | 'visual' // Bento Grid

// ============================================================================
// Section Registry
// ============================================================================

export const SECTION_REGISTRY: SectionTypeDefinition[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // LAYOUT SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'hero-section',
    label: 'Hero',
    description: 'Large banner section with headline, image, and call-to-action',
    icon: 'layout-template',
    category: 'layout',
    supportsCollections: false,
    defaultVariant: 'simple-centered',
    variants: [
      { id: 'simple-centered', label: 'Simple Centered' },
      { id: 'simple-centered-with-background', label: 'Simple Centered with Background' },
      { id: 'split-with-image', label: 'Split with Image' },
      { id: 'with-app-screenshot', label: 'With App Screenshot' },
      { id: 'with-phone-mockup', label: 'With Phone Mockup' },
      { id: 'with-image-tiles', label: 'With Image Tiles' },
      { id: 'with-offset-image', label: 'With Offset Image' },
      { id: 'with-angled-image', label: 'With Angled Image' },
    ],
  },
  {
    type: 'header-section',
    label: 'Header',
    description: 'Page header with title and optional description',
    icon: 'heading',
    category: 'layout',
    supportsCollections: false,
    defaultVariant: 'simple',
    variants: [
      { id: 'centered', label: 'Centered' },
      { id: 'centered-with-eyebrow', label: 'Centered with Eyebrow' },
      { id: 'centered-with-background-image', label: 'Centered with Background Image' },
      { id: 'simple', label: 'Simple' },
      { id: 'simple-with-eyebrow', label: 'Simple with Eyebrow' },
      { id: 'simple-with-background-image', label: 'Simple with Background Image' },
      { id: 'with-cards', label: 'With Cards' },
      { id: 'with-stats', label: 'With Stats' },
    ],
  },
  {
    type: 'footer-section',
    label: 'Footer',
    description: 'Page footer with navigation, social links, and legal info',
    icon: 'square-bottom-dashed-scissors',
    category: 'layout',
    supportsCollections: false,
    defaultVariant: 'simple-centered',
    variants: [
      { id: '4-column-simple', label: '4-Column Simple' },
      { id: '4-column-with-newsletter', label: '4-Column with Newsletter' },
      { id: '4-column-with-mission', label: '4-Column with Mission' },
      { id: '4-column-with-cta', label: '4-Column with CTA' },
      { id: '4-column-with-newsletter-below', label: '4-Column with Newsletter Below' },
      { id: 'simple-centered', label: 'Simple Centered' },
      { id: 'simple-with-social-links', label: 'Simple with Social Links' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CONTENT SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'content-section',
    label: 'Content',
    description: 'Rich content with text, images, and media',
    icon: 'file-text',
    category: 'content',
    supportsCollections: false,
    defaultVariant: 'centered',
    variants: [
      { id: 'centered', label: 'Centered' },
      { id: 'split-with-image', label: 'Split with Image' },
      { id: 'two-columns-with-screenshot', label: 'Two Columns with Screenshot' },
      { id: 'with-image-tiles', label: 'With Image Tiles' },
      { id: 'with-sticky-product-screenshot', label: 'With Sticky Product Screenshot' },
      { id: 'with-testimonial-and-stats', label: 'With Testimonial and Stats' },
      { id: 'with-testimonial', label: 'With Testimonial' },
    ],
  },
  {
    type: 'feature-section',
    label: 'Features',
    description: 'Highlight product features or benefits',
    icon: 'sparkles',
    category: 'content',
    supportsCollections: false,
    defaultVariant: 'simple-3x2-grid',
    variants: [
      { id: 'simple', label: 'Simple' },
      { id: 'simple-3x2-grid', label: 'Simple 3x2 Grid' },
      { id: 'centered-2x2-grid', label: 'Centered 2x2 Grid' },
      { id: 'offset-2x2-grid', label: 'Offset 2x2 Grid' },
      { id: 'offset-with-feature-list', label: 'Offset with Feature List' },
      { id: 'three-column-with-large-icons', label: 'Three Column with Large Icons' },
      { id: 'three-column-with-small-icons', label: 'Three Column with Small Icons' },
      { id: 'with-product-screenshot', label: 'With Product Screenshot' },
      { id: 'with-product-screenshot-on-left', label: 'With Product Screenshot on Left' },
      { id: 'with-product-screenshot-panel', label: 'With Product Screenshot Panel' },
      { id: 'with-large-screenshot', label: 'With Large Screenshot' },
      { id: 'with-large-bordered-screenshot', label: 'With Large Bordered Screenshot' },
      { id: 'with-code-example-panel', label: 'With Code Example Panel' },
      { id: 'contained-in-panel', label: 'Contained in Panel' },
      { id: 'with-testimonial', label: 'With Testimonial' },
    ],
  },
  {
    type: 'stats-section',
    label: 'Stats',
    description: 'Display key metrics and statistics',
    icon: 'bar-chart-3',
    category: 'content',
    supportsCollections: false,
    defaultVariant: 'simple-grid',
    variants: [
      { id: 'simple', label: 'Simple' },
      { id: 'simple-grid', label: 'Simple Grid' },
      { id: 'with-description', label: 'With Description' },
      { id: 'split-with-image', label: 'Split with Image' },
      { id: 'stepped', label: 'Stepped' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'with-background-image', label: 'With Background Image' },
      { id: 'with-two-column-description', label: 'With Two Column Description' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOCIAL PROOF SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'testimonial-section',
    label: 'Testimonials',
    description: 'Customer testimonials and reviews',
    icon: 'message-square-quote',
    category: 'social-proof',
    supportsCollections: true,
    collectionTypes: ['testimonials', 'reviews'],
    defaultVariant: 'simple-centered',
    variants: [
      { id: 'simple-centered', label: 'Simple Centered' },
      { id: 'with-large-avatar', label: 'With Large Avatar' },
      { id: 'with-star-rating', label: 'With Star Rating' },
      { id: 'side-by-side', label: 'Side by Side' },
      { id: 'grid', label: 'Grid' },
      { id: 'subtle-grid', label: 'Subtle Grid' },
      { id: 'with-background-image', label: 'With Background Image' },
      { id: 'with-overlapping-image', label: 'With Overlapping Image' },
    ],
  },
  {
    type: 'logo-cloud-section',
    label: 'Logo Cloud',
    description: 'Display partner or client logos',
    icon: 'building-2',
    category: 'social-proof',
    supportsCollections: true,
    collectionTypes: ['partners', 'clients'],
    defaultVariant: 'simple',
    variants: [
      { id: 'simple', label: 'Simple' },
      { id: 'simple-left-aligned', label: 'Simple Left Aligned' },
      { id: 'simple-with-heading', label: 'Simple with Heading' },
      { id: 'simple-with-cta', label: 'Simple with CTA' },
      { id: 'grid', label: 'Grid' },
      { id: 'split-with-logos-on-right', label: 'Split with Logos on Right' },
    ],
  },
  {
    type: 'team-section',
    label: 'Team',
    description: 'Team member profiles and bios',
    icon: 'users',
    category: 'social-proof',
    supportsCollections: true,
    collectionTypes: ['team', 'staff'],
    defaultVariant: 'with-medium-images',
    variants: [
      { id: 'with-small-images', label: 'With Small Images' },
      { id: 'with-medium-images', label: 'With Medium Images' },
      { id: 'with-large-images', label: 'With Large Images' },
      { id: 'with-vertical-images', label: 'With Vertical Images' },
      { id: 'full-width-vertical-images', label: 'Full Width Vertical Images' },
      { id: 'grid-round-images', label: 'Grid Round Images' },
      { id: 'grid-large-round-images', label: 'Grid Large Round Images' },
      { id: 'large-grid-with-cards', label: 'Large Grid with Cards' },
      { id: 'with-image-and-paragraph', label: 'With Image and Paragraph' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ENGAGEMENT SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'cta-section',
    label: 'Call to Action',
    description: 'Encourage visitors to take action',
    icon: 'pointer',
    category: 'engagement',
    supportsCollections: false,
    defaultVariant: 'simple-centered',
    variants: [
      { id: 'simple-centered', label: 'Simple Centered' },
      { id: 'simple-stacked', label: 'Simple Stacked' },
      { id: 'simple-justified', label: 'Simple Justified' },
      { id: 'centered-on-dark-panel', label: 'Centered on Dark Panel' },
      { id: 'simple-centered-on-brand', label: 'Simple Centered on Brand' },
      { id: 'simple-centered-with-gradient', label: 'Simple Centered with Gradient' },
      { id: 'simple-justified-on-subtle-brand', label: 'Simple Justified on Subtle Brand' },
      { id: 'split-with-image', label: 'Split with Image' },
      { id: 'dark-panel-with-app-screenshot', label: 'Dark Panel with App Screenshot' },
      { id: 'two-columns-with-photo', label: 'Two Columns with Photo' },
      { id: 'with-image-tiles', label: 'With Image Tiles' },
    ],
  },
  {
    type: 'newsletter-section',
    label: 'Newsletter',
    description: 'Email signup form for newsletter',
    icon: 'mail',
    category: 'engagement',
    supportsCollections: false,
    defaultVariant: 'simple-stacked',
    variants: [
      { id: 'simple-stacked', label: 'Simple Stacked' },
      { id: 'simple-side-by-side', label: 'Simple Side by Side' },
      { id: 'simple-side-by-side-on-brand', label: 'Simple Side by Side on Brand' },
      { id: 'centered-card', label: 'Centered Card' },
      { id: 'side-by-side-on-card', label: 'Side by Side on Card' },
      { id: 'side-by-side-with-details', label: 'Side by Side with Details' },
    ],
  },
  {
    type: 'contact-section',
    label: 'Contact',
    description: 'Contact form and information',
    icon: 'phone',
    category: 'engagement',
    supportsCollections: false,
    defaultVariant: 'simple-centered',
    variants: [
      { id: 'simple-centered', label: 'Simple Centered' },
      { id: 'four-column', label: 'Four Column' },
      { id: 'centered', label: 'Centered' },
      { id: 'side-by-side-grid', label: 'Side by Side Grid' },
      { id: 'split-with-image', label: 'Split with Image' },
      { id: 'split-with-pattern', label: 'Split with Pattern' },
      { id: 'with-testimonial', label: 'With Testimonial' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INFORMATION SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'faq-section',
    label: 'FAQ',
    description: 'Frequently asked questions',
    icon: 'help-circle',
    category: 'information',
    supportsCollections: true,
    collectionTypes: ['faq'],
    defaultVariant: 'centered-accordion',
    variants: [
      { id: 'centered-accordion', label: 'Centered Accordion' },
      { id: 'offset-with-supporting-text', label: 'Offset with Supporting Text' },
      { id: 'side-by-side', label: 'Side by Side' },
      { id: 'three-columns-with-centered-intro', label: 'Three Columns with Centered Intro' },
      { id: 'three-columns', label: 'Three Columns' },
      { id: 'two-columns-with-centered-intro', label: 'Two Columns with Centered Intro' },
      { id: 'two-columns', label: 'Two Columns' },
    ],
  },
  {
    type: 'pricing-section',
    label: 'Pricing',
    description: 'Pricing plans and comparison',
    icon: 'credit-card',
    category: 'information',
    supportsCollections: true,
    collectionTypes: ['pricing-plans'],
    defaultVariant: 'three-tiers',
    variants: [
      { id: 'three-tiers', label: 'Three Tiers' },
      { id: 'three-tiers-with-toggle', label: 'Three Tiers with Toggle' },
      { id: 'three-tiers-with-dividers', label: 'Three Tiers with Dividers' },
      { id: 'three-tiers-emphasized', label: 'Three Tiers Emphasized' },
      { id: 'three-tiers-with-comparison', label: 'Three Tiers with Comparison' },
      { id: 'two-tiers', label: 'Two Tiers' },
      { id: 'two-tiers-with-extra', label: 'Two Tiers with Extra' },
      { id: 'single-price', label: 'Single Price' },
      { id: 'four-tiers-with-toggle', label: 'Four Tiers with Toggle' },
      { id: 'with-comparison-table', label: 'With Comparison Table' },
    ],
  },
  {
    type: 'blog-section',
    label: 'Blog',
    description: 'Blog post listings and previews',
    icon: 'newspaper',
    category: 'information',
    supportsCollections: true,
    collectionTypes: ['blog', 'news', 'articles'],
    defaultVariant: 'three-column-with-images',
    variants: [
      { id: 'single-column', label: 'Single Column' },
      { id: 'single-column-with-images', label: 'Single Column with Images' },
      { id: 'three-column', label: 'Three Column' },
      { id: 'three-column-with-images', label: 'Three Column with Images' },
      { id: 'three-column-with-background-images', label: 'Three Column with Background Images' },
      { id: 'with-featured-post', label: 'With Featured Post' },
      { id: 'with-photo-and-list', label: 'With Photo and List' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VISUAL SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'bento-grid-section',
    label: 'Bento Grid',
    description: 'Visual grid layout for showcasing content',
    icon: 'layout-grid',
    category: 'visual',
    supportsCollections: false,
    defaultVariant: 'three-column',
    variants: [
      { id: 'three-column', label: 'Three Column' },
      { id: 'two-row', label: 'Two Row' },
      { id: 'two-row-three-column-second-row', label: 'Two Row Three Column Second Row' },
    ],
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a section definition by type
 */
export function getSectionDefinition(type: string): SectionTypeDefinition | undefined {
  return SECTION_REGISTRY.find((s) => s.type === type)
}

/**
 * Get all section definitions for a category
 */
export function getSectionsByCategory(category: SectionCategory): SectionTypeDefinition[] {
  return SECTION_REGISTRY.filter((s) => s.category === category)
}

/**
 * Get sections that support a specific collection type
 */
export function getSectionsForCollection(collectionType: string): SectionTypeDefinition[] {
  return SECTION_REGISTRY.filter(
    (s) => s.supportsCollections && s.collectionTypes?.includes(collectionType)
  )
}

/**
 * Get all sections that support collections
 */
export function getCollectionSections(): SectionTypeDefinition[] {
  return SECTION_REGISTRY.filter((s) => s.supportsCollections)
}

/**
 * Get variant definition for a section
 */
export function getSectionVariant(
  type: string,
  variantId: string
): SectionVariant | undefined {
  const section = getSectionDefinition(type)
  return section?.variants.find((v) => v.id === variantId)
}

/**
 * Get the default variant for a section type
 */
export function getDefaultVariant(type: string): string {
  const section = getSectionDefinition(type)
  return section?.defaultVariant || 'default'
}

/**
 * Check if a section type exists
 */
export function isValidSectionType(type: string): boolean {
  return SECTION_REGISTRY.some((s) => s.type === type)
}

/**
 * Check if a variant exists for a section type
 */
export function isValidVariant(type: string, variantId: string): boolean {
  const section = getSectionDefinition(type)
  return section?.variants.some((v) => v.id === variantId) ?? false
}

/**
 * Get all unique categories
 */
export function getAllCategories(): SectionCategory[] {
  return [...new Set(SECTION_REGISTRY.map((s) => s.category))]
}

/**
 * Get category label for display
 */
export function getCategoryLabel(category: SectionCategory): string {
  const labels: Record<SectionCategory, string> = {
    layout: 'Layout',
    content: 'Content',
    'social-proof': 'Social Proof',
    engagement: 'Engagement',
    information: 'Information',
    visual: 'Visual',
  }
  return labels[category]
}
