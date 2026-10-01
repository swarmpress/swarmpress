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

/**
 * Content field types for agent routing
 * - text: Routed to Writer Agent
 * - image: Routed to Media Production Agent
 * - video: Routed to Media Production Agent
 * - array-text: Array of text items (Writer)
 * - array-image: Array of images (Media)
 * - object: Complex nested object (may contain both)
 */
export type ContentFieldType =
  | 'text'
  | 'image'
  | 'video'
  | 'array-text'
  | 'array-image'
  | 'object'

/**
 * Field definition for content schema
 */
export interface SectionFieldDefinition {
  name: string
  label: string
  type: ContentFieldType
  required?: boolean
  description?: string
  /** For object types, nested field definitions */
  fields?: SectionFieldDefinition[]
  /** For array types, the item field type */
  itemType?: ContentFieldType
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
  /** Content fields for this section type - used for agent routing and per-field hints */
  contentFields?: SectionFieldDefinition[]
}

export type SectionCategory =
  | 'layout' // Hero, Header, Footer
  | 'content' // Content, Features, Stats
  | 'social-proof' // Testimonials, Logo Cloud, Team
  | 'engagement' // CTA, Newsletter, Contact
  | 'information' // FAQ, Pricing, Blog
  | 'visual' // Bento Grid
  | 'editorial' // Editorial blocks (hero, intro, interlude, notes)
  | 'theme' // Theme-specific blocks (village, travel, weather)
  | 'template' // Page template blocks (itinerary, blog, collection pages)

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
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Main headline' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text below title' },
      { name: 'eyebrow', label: 'Eyebrow', type: 'text', description: 'Small text above title' },
      { name: 'backgroundImage', label: 'Background Image', type: 'image', description: 'Full-width background' },
      { name: 'image', label: 'Hero Image', type: 'image', description: 'Primary hero image' },
      { name: 'screenshot', label: 'Screenshot', type: 'image', description: 'App or product screenshot' },
      { name: 'images', label: 'Image Gallery', type: 'array-image', description: 'Multiple images for tile layouts' },
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
    contentFields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text', description: 'Small text above title' },
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Main page title' },
      { name: 'description', label: 'Description', type: 'text', description: 'Page intro text' },
      { name: 'backgroundImage', label: 'Background Image', type: 'image', description: 'Background for header' },
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
    contentFields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text', description: 'Small text above title' },
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Section heading' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text' },
      { name: 'content', label: 'Content', type: 'text', required: true, description: 'Main content (markdown)' },
      { name: 'image', label: 'Image', type: 'image', description: 'Featured image' },
      { name: 'images', label: 'Image Gallery', type: 'array-image', description: 'Multiple images' },
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
    contentFields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text', description: 'Small text above title' },
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Section heading' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text' },
      { name: 'features', label: 'Features', type: 'array-text', description: 'List of feature items (title + description)' },
      { name: 'screenshot', label: 'Screenshot', type: 'image', description: 'Product screenshot' },
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
    contentFields: [
      { name: 'eyebrow', label: 'Eyebrow', type: 'text', description: 'Small text above title' },
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text' },
      { name: 'stats', label: 'Statistics', type: 'array-text', description: 'Stat items (value + label)' },
      { name: 'image', label: 'Image', type: 'image', description: 'Featured image' },
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
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Main call to action heading' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text' },
      { name: 'backgroundImage', label: 'Background Image', type: 'image', description: 'Background visual' },
      { name: 'image', label: 'Image', type: 'image', description: 'Featured image' },
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

  // ─────────────────────────────────────────────────────────────────────────
  // COLLECTION SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'collection-embed',
    label: 'Collection Embed',
    description: 'Embed a filtered list of collection items with customizable display options',
    icon: 'layout-grid',
    category: 'template',
    supportsCollections: true,
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'carousel', label: 'Carousel' },
      { id: 'compact', label: 'Compact' },
    ],
    collectionTypes: ['restaurants', 'accommodations', 'hotels', 'apartments', 'agriturismi', 'hikes', 'events', 'pois', 'beaches'],
    contentFields: [
      { name: 'collectionType', label: 'Collection Type', type: 'text', required: true, description: 'Type of collection (restaurants, accommodations, etc.)' },
      { name: 'heading', label: 'Heading', type: 'text', description: 'Section heading text' },
      { name: 'headingLevel', label: 'Heading Level', type: 'text', description: 'Heading level (1-6, default: 2)' },
      {
        name: 'items',
        label: 'Items',
        type: 'object',
        required: true,
        description: 'Collection items (JSON array with slug, title, summary, image, url, village, data)',
      },
      {
        name: 'display',
        label: 'Display Options',
        type: 'object',
        required: true,
        description: 'Display settings (JSON: layout, columns, showImage, showSummary, showDate, imageAspect)',
      },
      { name: 'showViewAll', label: 'Show View All', type: 'text', description: 'Show "View All" link (true/false)' },
      { name: 'viewAllUrl', label: 'View All URL', type: 'text', description: 'Custom URL for "View All" link' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY SECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'section-header',
    label: 'Section Header',
    description: 'Simple header label for sections',
    icon: 'heading',
    category: 'layout',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
    ],
    contentFields: [
      { name: 'label', label: 'Label', type: 'text', required: true, description: 'Section label text' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TEMPLATE SECTIONS (Cinque Terre Theme)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'collection-with-interludes',
    label: 'Collection with Interludes',
    description: 'Display collection items with editorial interludes between them',
    icon: 'layout-list',
    category: 'template',
    supportsCollections: true,
    collectionTypes: ['restaurants', 'accommodations', 'hikes', 'events', 'pois'],
    defaultVariant: 'restaurants',
    variants: [
      { id: 'restaurants', label: 'Restaurants' },
      { id: 'accommodations', label: 'Accommodations' },
      { id: 'hikes', label: 'Hikes' },
      { id: 'events', label: 'Events' },
      { id: 'pois', label: 'Points of Interest' },
    ],
    contentFields: [
      // New format (slug-based loading)
      { name: 'collectionType', label: 'Collection Type', type: 'text', description: 'Type of collection for slug-based loading (restaurants, accommodations, etc.)' },
      { name: 'slugs', label: 'Item Slugs', type: 'array-text', description: 'Ordered list of item slugs to display (new format)' },
      { name: 'village', label: 'Village Filter', type: 'text', description: 'Optional village to filter items' },
      // Legacy format (embedded items)
      { name: 'itemType', label: 'Item Type', type: 'text', description: 'Legacy: Item type for embedded items (accommodation, restaurant, etc.)' },
      {
        name: 'items',
        label: 'Items (Legacy)',
        type: 'object',
        description: 'Legacy: Embedded collection items (JSON array with id, name, type, description, image, etc.)',
      },
      // Common
      {
        name: 'interludes',
        label: 'Interludes',
        type: 'object',
        description: 'Editorial interludes inserted between items (JSON array with afterIndex, type, badge, title, quote, icon, align)',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EDITORIAL SECTIONS (Cinque Terre Theme)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'editorial-hero',
    label: 'Editorial Hero',
    description: 'Large hero with badge, title, subtitle, and background image for editorial content',
    icon: 'image',
    category: 'editorial',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'tall', label: 'Tall' },
      { id: 'compact', label: 'Compact' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Main headline (LocalizedText)' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Supporting text below title (LocalizedText)' },
      { name: 'badge', label: 'Badge', type: 'text', description: 'Category or label badge (LocalizedText)' },
      { name: 'image', label: 'Background Image', type: 'image', required: true, description: 'Full-width background image URL' },
      { name: 'height', label: 'Height', type: 'text', description: 'Section height CSS value (default: "80vh")' },
    ],
  },
  {
    type: 'editorial-intro',
    label: 'Editorial Intro',
    description: 'Article introduction with lead paragraph and optional author info',
    icon: 'text',
    category: 'editorial',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'with-author', label: 'With Author' },
      { id: 'centered', label: 'Centered' },
    ],
    contentFields: [
      { name: 'badge', label: 'Badge', type: 'text', required: true, description: 'Section badge text (LocalizedText)' },
      { name: 'quote', label: 'Quote', type: 'text', required: true, description: 'Featured quote (LocalizedText)' },
      { name: 'content', label: 'Content', type: 'array-text', description: 'Content paragraphs, split into columns (LocalizedArray)' },
      { name: 'leftContent', label: 'Left Content', type: 'text', description: 'Left column markdown content (LocalizedText)' },
      { name: 'rightContent', label: 'Right Content', type: 'text', description: 'Right column markdown content (LocalizedText)' },
    ],
  },
  {
    type: 'editorial-interlude',
    label: 'Editorial Interlude',
    description: 'Visual break between content sections with image and quote',
    icon: 'separator-horizontal',
    category: 'editorial',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'full-width', label: 'Full Width' },
      { id: 'quote-only', label: 'Quote Only' },
    ],
    contentFields: [
      { name: 'badge', label: 'Badge', type: 'text', description: 'Badge text (default: "Editorial Interlude")' },
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Interlude title' },
      { name: 'quote', label: 'Quote', type: 'text', required: true, description: 'Featured quote text' },
      { name: 'interludeType', label: 'Type', type: 'text', description: 'Interlude type: primary or secondary' },
      { name: 'align', label: 'Alignment', type: 'text', description: 'Text alignment: left or right' },
      { name: 'icon', label: 'Icon', type: 'text', description: 'Optional icon identifier' },
    ],
  },
  {
    type: 'editor-note',
    label: 'Editor Note',
    description: "Personal note or recommendation from the editor",
    icon: 'pen-line',
    category: 'editorial',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'highlighted', label: 'Highlighted' },
      { id: 'sidebar', label: 'Sidebar' },
    ],
    contentFields: [
      { name: 'quote', label: 'Quote', type: 'text', required: true, description: "Editor's quote or comment" },
      { name: 'author', label: 'Author', type: 'text', description: 'Author name (default: Giulia Rossi)' },
      { name: 'role', label: 'Role', type: 'text', description: 'Author role (default: Riomaggiore Expert)' },
      { name: 'image', label: 'Author Image', type: 'image', description: 'Author photo' },
    ],
  },
  {
    type: 'closing-note',
    label: 'Closing Note',
    description: 'Article conclusion with final thoughts and call to action',
    icon: 'badge-check',
    category: 'editorial',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'with-cta', label: 'With Call to Action' },
      { id: 'minimal', label: 'Minimal' },
    ],
    contentFields: [
      { name: 'badge', label: 'Badge', type: 'text', description: 'Badge text (default: "A Final Reflection") (LocalizedText)' },
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Closing title (LocalizedText)' },
      { name: 'content', label: 'Content', type: 'text', required: true, description: 'Content paragraphs (LocalizedText or LocalizedArray)' },
      { name: 'actions', label: 'Action Buttons', type: 'object', description: 'Button actions (JSON array with label, href, variant)' },
      { name: 'backgroundIcon', label: 'Background Icon', type: 'text', description: 'Optional background icon' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THEME SECTIONS (Cinque Terre - Village & Travel)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'village-selector',
    label: 'Village Selector',
    description: 'Navigation component for switching between Cinque Terre villages',
    icon: 'map-pin',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'horizontal',
    variants: [
      { id: 'horizontal', label: 'Horizontal' },
      { id: 'vertical', label: 'Vertical' },
      { id: 'map', label: 'Map View' },
    ],
    contentFields: [
      { name: 'currentVillage', label: 'Current Village', type: 'text', description: 'Currently selected village slug' },
    ],
  },
  {
    type: 'village-intro',
    label: 'Village Intro',
    description: 'Village overview with essentials, character, and weather info',
    icon: 'home',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'compact', label: 'Compact' },
      { id: 'expanded', label: 'Expanded' },
    ],
    contentFields: [
      { name: 'village', label: 'Village', type: 'text', required: true, description: 'Village slug' },
      { name: 'description', label: 'Description', type: 'text', description: 'Village overview text' },
    ],
  },
  {
    type: 'places-to-stay',
    label: 'Places to Stay',
    description: 'Accommodation listings with filtering and booking info',
    icon: 'bed',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['accommodations', 'hotels', 'apartments', 'agriturismi'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'featured', label: 'Featured' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'village', label: 'Village Filter', type: 'text', description: 'Filter by village' },
      { name: 'limit', label: 'Item Limit', type: 'text', description: 'Max items to show' },
    ],
  },
  {
    type: 'eat-drink',
    label: 'Eat & Drink',
    description: 'Restaurant and dining listings with categories',
    icon: 'utensils',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['restaurants', 'bars', 'cafes'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'featured', label: 'Featured' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'village', label: 'Village Filter', type: 'text', description: 'Filter by village' },
      { name: 'category', label: 'Category', type: 'text', description: 'Restaurant category filter' },
    ],
  },
  {
    type: 'highlights',
    label: 'Highlights',
    description: 'Village highlights grid with key attractions',
    icon: 'star',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['pois', 'attractions', 'sights'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'carousel', label: 'Carousel' },
      { id: 'masonry', label: 'Masonry' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'village', label: 'Village', type: 'text', description: 'Village slug' },
      { name: 'items', label: 'Highlight Items', type: 'array-text', description: 'Manual list of highlights' },
    ],
  },
  {
    type: 'featured-carousel',
    label: 'Featured Carousel',
    description: 'Horizontal scrolling carousel of featured content',
    icon: 'gallery-horizontal',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['articles', 'blog', 'features'],
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'large', label: 'Large Cards' },
      { id: 'compact', label: 'Compact' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'items', label: 'Featured Items', type: 'array-text', description: 'Item slugs to feature' },
    ],
  },
  {
    type: 'trending-now',
    label: 'Trending Now',
    description: 'Current trending topics and popular content',
    icon: 'trending-up',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'compact', label: 'Compact' },
      { id: 'sidebar', label: 'Sidebar' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'topics', label: 'Topics', type: 'array-text', description: 'Trending topic items' },
    ],
  },
  {
    type: 'about',
    label: 'About Section',
    description: 'About section with description and team/story info',
    icon: 'info',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'with-image', label: 'With Image' },
      { id: 'team', label: 'Team Focus' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'content', label: 'Content', type: 'text', required: true, description: 'About text (markdown)' },
      { name: 'image', label: 'Image', type: 'image', description: 'Featured image' },
    ],
  },
  {
    type: 'curated-escapes',
    label: 'Curated Escapes',
    description: 'Curated travel packages and experiences',
    icon: 'compass',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['packages', 'experiences', 'tours'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'featured', label: 'Featured' },
      { id: 'list', label: 'List' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Section description' },
      { name: 'packages', label: 'Package Slugs', type: 'array-text', description: 'Package items to display' },
    ],
  },
  {
    type: 'latest-stories',
    label: 'Latest Stories',
    description: 'Recent blog posts and articles',
    icon: 'book-open',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['blog', 'articles', 'stories'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'featured', label: 'Featured First' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'limit', label: 'Post Limit', type: 'text', description: 'Number of posts to show' },
      { name: 'category', label: 'Category Filter', type: 'text', description: 'Filter by category' },
    ],
  },
  {
    type: 'audio-guides',
    label: 'Audio Guides',
    description: 'Audio tour guides and narrated content',
    icon: 'headphones',
    category: 'theme',
    supportsCollections: true,
    collectionTypes: ['audio', 'tours'],
    defaultVariant: 'list',
    variants: [
      { id: 'list', label: 'List' },
      { id: 'grid', label: 'Grid' },
      { id: 'player', label: 'With Player' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'village', label: 'Village', type: 'text', description: 'Village filter' },
      { name: 'guides', label: 'Audio Guide Slugs', type: 'array-text', description: 'Audio guide items' },
    ],
  },
  {
    type: 'practical-advice',
    label: 'Practical Advice',
    description: 'Travel tips and practical information',
    icon: 'lightbulb',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'accordion',
    variants: [
      { id: 'accordion', label: 'Accordion' },
      { id: 'cards', label: 'Cards' },
      { id: 'list', label: 'List' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'tips', label: 'Tips', type: 'array-text', required: true, description: 'Advice items (title + content)' },
    ],
  },
  {
    type: 'weather-live',
    label: 'Live Weather',
    description: 'Live weather widget with current conditions',
    icon: 'cloud-sun',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'compact', label: 'Compact' },
      { id: 'detailed', label: 'Detailed' },
    ],
    contentFields: [
      { name: 'village', label: 'Village', type: 'text', description: 'Village for weather data' },
      { name: 'showForecast', label: 'Show Forecast', type: 'text', description: 'Include multi-day forecast' },
    ],
  },
  {
    type: 'weather-journal',
    label: 'Weather Journal',
    description: 'Historical weather data and seasonal patterns',
    icon: 'calendar-days',
    category: 'theme',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'chart', label: 'Chart View' },
      { id: 'calendar', label: 'Calendar View' },
    ],
    contentFields: [
      { name: 'village', label: 'Village', type: 'text', description: 'Village for weather history' },
      { name: 'period', label: 'Time Period', type: 'text', description: 'Historical period to show' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TEMPLATE SECTIONS (Page Templates)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'itinerary-hero',
    label: 'Itinerary Hero',
    description: 'Hero section for travel itinerary pages',
    icon: 'route',
    category: 'template',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'with-map', label: 'With Map' },
      { id: 'compact', label: 'Compact' },
    ],
    contentFields: [
      { name: 'name', label: 'Name', type: 'text', required: true, description: 'Itinerary name' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Trip description (optional tagline)' },
      { name: 'duration', label: 'Duration', type: 'text', required: true, description: 'Trip duration (e.g., "4 Days")' },
      { name: 'pace', label: 'Pace', type: 'text', required: true, description: 'Travel pace (e.g., "Leisurely")' },
      { name: 'effort', label: 'Effort', type: 'text', required: true, description: 'Physical effort level (e.g., "Moderate")' },
      { name: 'bestSeason', label: 'Best Season', type: 'text', required: true, description: 'Best time to visit (e.g., "Apr–Jun, Sep–Oct")' },
      { name: 'image', label: 'Hero Image', type: 'image', required: true, description: 'Full-width background image' },
      { name: 'badge', label: 'Badge', type: 'text', description: 'Badge text (default: "Signature Itinerary")' },
    ],
  },
  {
    type: 'itinerary-days',
    label: 'Itinerary Days',
    description: 'Day-by-day itinerary breakdown',
    icon: 'calendar-range',
    category: 'template',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'cards', label: 'Cards' },
    ],
    contentFields: [
      {
        name: 'days',
        label: 'Days',
        type: 'object',
        required: true,
        description: 'Day entries (JSON array: number, title, village, rhythm?, perspective, movement?, moments[], image?)',
      },
      { name: 'showOverview', label: 'Show Overview', type: 'text', description: 'Show overview grid at top (true/false, default: true)' },
    ],
  },
  {
    type: 'blog-article',
    label: 'Blog Article',
    description: 'Full blog article layout with content blocks',
    icon: 'file-text',
    category: 'template',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'wide', label: 'Wide' },
      { id: 'sidebar', label: 'With Sidebar' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', required: true, description: 'Article title' },
      { name: 'subtitle', label: 'Subtitle', type: 'text', description: 'Article subtitle or tagline' },
      { name: 'heroImage', label: 'Hero Image', type: 'image', description: 'Full-width hero image above article' },
      { name: 'author', label: 'Author', type: 'text', description: 'Author name (or JSON object with name, bio, image)' },
      { name: 'authorImage', label: 'Author Image', type: 'image', description: 'Author photo' },
      { name: 'date', label: 'Date', type: 'text', description: 'Publication date' },
      { name: 'readTime', label: 'Read Time', type: 'text', description: 'Estimated read time (e.g., "8 min read")' },
      { name: 'category', label: 'Category', type: 'text', description: 'Article category' },
      { name: 'content', label: 'Content', type: 'object', required: true, description: 'Article content (JSON: ContentBlock[] or EditorialContent object)' },
      { name: 'sidebar', label: 'Sidebar', type: 'object', description: 'Sidebar content (JSON: keyTakeaways[], relatedPosts[])' },
    ],
  },
  {
    type: 'blog-index',
    label: 'Blog Index',
    description: 'Blog listing page with filtering and pagination',
    icon: 'layout-list',
    category: 'template',
    supportsCollections: true,
    collectionTypes: ['blog', 'articles'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'featured-first', label: 'Featured First' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Page title' },
      { name: 'postsPerPage', label: 'Posts Per Page', type: 'text', description: 'Pagination limit' },
      { name: 'category', label: 'Category Filter', type: 'text', description: 'Filter by category' },
    ],
  },
  {
    type: 'team-grid',
    label: 'Team Grid',
    description: 'Team member grid with photos and bios',
    icon: 'users',
    category: 'template',
    supportsCollections: true,
    collectionTypes: ['team', 'staff'],
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
      { id: 'cards', label: 'Cards' },
    ],
    contentFields: [
      {
        name: 'editors',
        label: 'Editors/Team Members',
        type: 'object',
        required: true,
        description: 'Team members (JSON array: name, role, bio, image, persona?, love?, hobbies?, accent?)',
      },
    ],
  },
  {
    type: 'airports-overview',
    label: 'Airports Overview',
    description: 'Transportation guide with nearby airports and connections',
    icon: 'plane',
    category: 'template',
    supportsCollections: false,
    defaultVariant: 'default',
    variants: [
      { id: 'default', label: 'Default' },
      { id: 'map', label: 'With Map' },
      { id: 'table', label: 'Table View' },
    ],
    contentFields: [
      { name: 'title', label: 'Title', type: 'text', description: 'Section heading' },
      { name: 'airports', label: 'Airports', type: 'array-text', required: true, description: 'Airport information entries' },
      { name: 'destination', label: 'Destination', type: 'text', description: 'Target destination name' },
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
    editorial: 'Editorial',
    theme: 'Theme',
    template: 'Templates',
  }
  return labels[category]
}

// ============================================================================
// Field Type Helpers (for agent routing)
// ============================================================================

const TEXT_FIELD_TYPES: ContentFieldType[] = ['text', 'array-text']
const MEDIA_FIELD_TYPES: ContentFieldType[] = ['image', 'video', 'array-image']

/**
 * Check if a field type is a text type (routed to Writer Agent)
 */
export function isTextFieldType(type: ContentFieldType): boolean {
  return TEXT_FIELD_TYPES.includes(type)
}

/**
 * Check if a field type is a media type (routed to Media Production Agent)
 */
export function isMediaFieldType(type: ContentFieldType): boolean {
  return MEDIA_FIELD_TYPES.includes(type)
}

/**
 * Get text fields for a section type (for Writer Agent)
 */
export function getTextFields(sectionType: string): SectionFieldDefinition[] {
  const section = getSectionDefinition(sectionType)
  if (!section?.contentFields) return []
  return section.contentFields.filter((f) => isTextFieldType(f.type))
}

/**
 * Get media fields for a section type (for Media Production Agent)
 */
export function getMediaFields(sectionType: string): SectionFieldDefinition[] {
  const section = getSectionDefinition(sectionType)
  if (!section?.contentFields) return []
  return section.contentFields.filter((f) => isMediaFieldType(f.type))
}

/**
 * Get all content fields for a section type
 */
export function getContentFields(sectionType: string): SectionFieldDefinition[] {
  const section = getSectionDefinition(sectionType)
  return section?.contentFields || []
}
