import { z } from 'zod'

/**
 * JSON Block Model — Canonical content format for swarm.press
 * See: /domain/content-model/JSON_BLOCK_MODEL.md
 */

// ============================================================================
// Base Types
// ============================================================================

const ImageObjectSchema = z.object({
  src: z.string().url(),
  alt: z.string(),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

const FAQItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
})

// ============================================================================
// Block Schemas
// ============================================================================

export const ParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  markdown: z.string().min(1),
})

export const HeadingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1),
  id: z.string().optional(),
})

export const HeroBlockSchema = z.object({
  type: z.literal('hero'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  backgroundImage: z.string().url().optional(),
})

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  src: z.string().min(1), // URL or S3 path
  alt: z.string().min(1),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const GalleryBlockSchema = z.object({
  type: z.literal('gallery'),
  layout: z.enum(['grid', 'carousel', 'masonry']),
  images: z.array(ImageObjectSchema).min(1),
})

export const QuoteBlockSchema = z.object({
  type: z.literal('quote'),
  text: z.string().min(1),
  attribution: z.string().optional(),
})

export const ListBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.string().min(1)).min(1),
})

export const FAQBlockSchema = z.object({
  type: z.literal('faq'),
  items: z.array(FAQItemSchema).min(1),
})

export const CalloutBlockSchema = z.object({
  type: z.literal('callout'),
  style: z.enum(['info', 'warning', 'success', 'error']),
  title: z.string().optional(),
  content: z.string().min(1),
})

export const EmbedBlockSchema = z.object({
  type: z.literal('embed'),
  provider: z.enum(['youtube', 'vimeo', 'maps', 'custom']),
  url: z.string().url(),
  title: z.string().optional(),
})

const CollectionEmbedItemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  image: z.string().optional(),
  date: z.string().optional(),
  url: z.string().optional(),
  data: z.record(z.unknown()),
})

const CollectionEmbedDisplaySchema = z.object({
  layout: z.enum(['grid', 'list', 'carousel', 'compact']),
  columns: z.number().int().min(1).max(6).optional(),
  showImage: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  showDate: z.boolean().optional(),
  imageAspect: z.enum(['square', 'video', 'portrait', 'landscape']).optional(),
})

export const CollectionEmbedBlockSchema = z.object({
  type: z.literal('collection-embed'),
  collectionType: z.string(),
  displayName: z.string().optional(),
  singularName: z.string().optional(),
  items: z.array(CollectionEmbedItemSchema),
  display: CollectionEmbedDisplaySchema,
  heading: z.string().optional(),
  headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).optional(),
  showViewAll: z.boolean().optional(),
  viewAllUrl: z.string().optional(),
})

// ============================================================================
// TailwindCSS Plus Section Block Schemas
// ============================================================================

// Common Types for Section Blocks
const ButtonSchema = z.object({
  text: z.string(),
  url: z.string(),
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost']).default('primary'),
  external: z.boolean().optional(),
})

const NavItemSchema = z.object({
  label: z.string(),
  url: z.string(),
  external: z.boolean().optional(),
})

const FeatureItemSchema = z.object({
  icon: z.string().optional(),
  title: z.string(),
  description: z.string(),
})

const TeamMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  image: z.string().optional(),
  bio: z.string().optional(),
  social: z.array(z.object({
    platform: z.string(),
    url: z.string(),
  })).optional(),
})

const TestimonialItemSchema = z.object({
  quote: z.string(),
  author: z.string(),
  role: z.string().optional(),
  company: z.string().optional(),
  image: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
})

const PricingTierSchema = z.object({
  name: z.string(),
  price: z.object({
    monthly: z.string(),
    annually: z.string().optional(),
  }),
  description: z.string().optional(),
  features: z.array(z.string()),
  cta: ButtonSchema,
  featured: z.boolean().optional(),
  badge: z.string().optional(),
})

const LogoItemSchema = z.object({
  name: z.string(),
  src: z.string(),
  url: z.string().optional(),
})

const StatItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const BlogPostSchema = z.object({
  title: z.string(),
  excerpt: z.string().optional(),
  image: z.string().optional(),
  url: z.string(),
  date: z.string().optional(),
  author: z.object({
    name: z.string(),
    image: z.string().optional(),
  }).optional(),
  category: z.string().optional(),
})

// Hero Section Variants
const HeroSectionVariantSchema = z.enum([
  'simple-centered',
  'simple-centered-with-background',
  'split-with-image',
  'split-with-screenshot',
  'split-with-bordered-screenshot',
  'split-with-code',
  'with-app-screenshot',
  'with-bordered-app-screenshot',
  'with-phone-mockup',
  'with-image-tiles',
  'with-angled-image',
  'with-offset-image',
])

export const HeroSectionBlockSchema = z.object({
  type: z.literal('hero-section'),
  variant: HeroSectionVariantSchema.default('simple-centered'),
  // Content
  title: z.string(),
  subtitle: z.string().optional(),
  eyebrow: z.string().optional(),
  eyebrowUrl: z.string().optional(),
  buttons: z.array(ButtonSchema).optional(),
  // Media
  backgroundImage: z.string().optional(),
  screenshot: z.string().optional(),
  screenshotDark: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  // Options
  showGradient: z.boolean().default(true),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
})

// Feature Section Variants
const FeatureSectionVariantSchema = z.enum([
  'simple-3x2-grid',
  'centered-2x2-grid',
  'offset-2x2-grid',
  'with-screenshot',
  'with-screenshot-left',
  'with-code-panel',
  'contained-panel',
  'offset-feature-list',
  'three-column-small-icons',
  'three-column-large-icons',
  'with-testimonial',
  'with-product-screenshot',
  'simple-three-column',
  'with-large-icons',
  'with-background',
])

export const FeatureSectionBlockSchema = z.object({
  type: z.literal('feature-section'),
  variant: FeatureSectionVariantSchema.default('simple-3x2-grid'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  features: z.array(FeatureItemSchema),
  // Media
  screenshot: z.string().optional(),
  screenshotDark: z.string().optional(),
  // Options
  columns: z.number().min(2).max(4).optional(),
})

// Pricing Section Variants
const PricingSectionVariantSchema = z.enum([
  'three-tiers',
  'three-tiers-with-toggle',
  'three-tiers-highlighted',
  'two-tiers',
  'two-tiers-with-extra',
  'single-price',
  'single-price-with-details',
  'with-comparison',
  'with-feature-comparison',
  'four-tiers',
  'simple-cards',
  'with-free-tier',
])

export const PricingSectionBlockSchema = z.object({
  type: z.literal('pricing-section'),
  variant: PricingSectionVariantSchema.default('three-tiers'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  tiers: z.array(PricingTierSchema),
  // Options
  billingToggle: z.boolean().default(false),
  comparisonFeatures: z.array(z.object({
    name: z.string(),
    tiers: z.record(z.union([z.boolean(), z.string()])),
  })).optional(),
})

// Testimonial Section Variants
const TestimonialSectionVariantSchema = z.enum([
  'simple-centered',
  'with-large-avatar',
  'side-by-side',
  'with-background-image',
  'grid',
  'carousel',
  'with-rating',
  'quote-only',
])

export const TestimonialSectionBlockSchema = z.object({
  type: z.literal('testimonial-section'),
  variant: TestimonialSectionVariantSchema.default('simple-centered'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  testimonials: z.array(TestimonialItemSchema),
  // Options
  showCompanyLogo: z.boolean().optional(),
})

// CTA Section Variants
const CtaSectionVariantSchema = z.enum([
  'simple-centered',
  'simple-stacked',
  'simple-justified',
  'split-with-image',
  'with-background-image',
  'with-app-screenshot',
  'brand-panel',
  'dark-panel',
  'with-input',
  'two-columns',
  'simple-dark',
])

export const CtaSectionBlockSchema = z.object({
  type: z.literal('cta-section'),
  variant: CtaSectionVariantSchema.default('simple-centered'),
  // Content
  title: z.string(),
  subtitle: z.string().optional(),
  buttons: z.array(ButtonSchema).optional(),
  // Media
  backgroundImage: z.string().optional(),
  image: z.string().optional(),
  // Options
  inputPlaceholder: z.string().optional(),
  inputButtonText: z.string().optional(),
})

// Blog Section Variants
const BlogSectionVariantSchema = z.enum([
  'three-column-cards',
  'three-column-with-background',
  'single-column',
  'two-column-with-images',
  'with-featured-post',
  'simple-list',
  'card-grid',
])

export const BlogSectionBlockSchema = z.object({
  type: z.literal('blog-section'),
  variant: BlogSectionVariantSchema.default('three-column-cards'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  posts: z.array(BlogPostSchema),
  // Options
  showCategories: z.boolean().optional(),
  viewAllUrl: z.string().optional(),
})

// Stats Section Variants
const StatsSectionVariantSchema = z.enum([
  'simple-grid',
  'simple-on-dark',
  'split-with-image',
  'with-description',
  'timeline-style',
  'with-background',
  'card-grid',
  'simple-centered',
])

export const StatsSectionBlockSchema = z.object({
  type: z.literal('stats-section'),
  variant: StatsSectionVariantSchema.default('simple-grid'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  stats: z.array(StatItemSchema),
  // Media
  image: z.string().optional(),
})

// Team Section Variants
const TeamSectionVariantSchema = z.enum([
  'simple-grid',
  'with-large-images',
  'with-small-images',
  'grid-with-large-round-images',
  'with-vertical-images',
  'with-bio',
  'dark-background',
  'with-social-links',
  'card-grid',
])

export const TeamSectionBlockSchema = z.object({
  type: z.literal('team-section'),
  variant: TeamSectionVariantSchema.default('simple-grid'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  members: z.array(TeamMemberSchema),
  // Options
  columns: z.number().min(2).max(6).optional(),
})

// Newsletter Section Variants
const NewsletterSectionVariantSchema = z.enum([
  'simple-centered',
  'simple-stacked',
  'side-by-side',
  'with-background',
  'card-style',
  'with-benefits',
])

export const NewsletterSectionBlockSchema = z.object({
  type: z.literal('newsletter-section'),
  variant: NewsletterSectionVariantSchema.default('simple-centered'),
  // Content
  title: z.string(),
  subtitle: z.string().optional(),
  inputPlaceholder: z.string().default('Enter your email'),
  buttonText: z.string().default('Subscribe'),
  disclaimer: z.string().optional(),
  // Options
  benefits: z.array(z.string()).optional(),
})

// Contact Section Variants
const ContactSectionVariantSchema = z.enum([
  'simple-centered',
  'split-with-pattern',
  'split-two-tone',
  'side-by-side',
  'with-card',
  'offices-grid',
  'simple-four-column',
])

export const ContactSectionBlockSchema = z.object({
  type: z.literal('contact-section'),
  variant: ContactSectionVariantSchema.default('simple-centered'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  // Contact Info
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  // Form Fields (if needed)
  showForm: z.boolean().default(true),
  formFields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['text', 'email', 'tel', 'textarea', 'select']),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
  })).optional(),
  // Offices (for multi-location)
  offices: z.array(z.object({
    city: z.string(),
    address: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
  })).optional(),
})

// FAQ Section Variants (Marketing-style, different from simple FAQ block)
const FaqSectionVariantSchema = z.enum([
  'centered-accordion',
  'side-by-side',
  'three-column',
  'with-supporting-text',
  'two-column-grid',
  'offset-with-supporting',
  'simple-centered',
])

export const FaqSectionBlockSchema = z.object({
  type: z.literal('faq-section'),
  variant: FaqSectionVariantSchema.default('centered-accordion'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  items: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })),
  // Options
  supportingText: z.string().optional(),
  contactEmail: z.string().optional(),
})

// Logo Cloud Section Variants
const LogoCloudSectionVariantSchema = z.enum([
  'simple-grid',
  'simple-with-heading',
  'split-with-grid',
  'simple-with-heading-on-dark',
  'off-white-grid',
  'simple-on-dark',
])

export const LogoCloudSectionBlockSchema = z.object({
  type: z.literal('logo-cloud-section'),
  variant: LogoCloudSectionVariantSchema.default('simple-grid'),
  // Content
  title: z.string().optional(),
  subtitle: z.string().optional(),
  logos: z.array(LogoItemSchema),
})

// Bento Grid Section Variants
const BentoGridSectionVariantSchema = z.enum([
  'two-row-layout',
  'three-row-asymmetric',
  'three-row-with-image',
  'two-row-with-images',
  'four-panel-layout',
  'two-column-layout',
  'three-column-with-feature',
  'asymmetric-grid',
])

export const BentoGridSectionBlockSchema = z.object({
  type: z.literal('bento-grid-section'),
  variant: BentoGridSectionVariantSchema.default('two-row-layout'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  items: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    image: z.string().optional(),
    span: z.enum(['1', '2', '3']).optional(),
    rowSpan: z.enum(['1', '2']).optional(),
  })),
})

// Banner Variants
const BannerVariantSchema = z.enum([
  'with-button',
  'with-link',
  'with-dismiss-button',
  'floating-at-bottom',
  'left-aligned-on-brand',
  'centered-with-icon',
  'privacy-notice',
  'split-with-image',
  'on-dark-nav',
  'with-countdown',
  'brand-color',
  'gradient-background',
  'simple-centered',
])

export const BannerBlockSchema = z.object({
  type: z.literal('banner'),
  variant: BannerVariantSchema.default('with-button'),
  // Content
  text: z.string(),
  linkText: z.string().optional(),
  linkUrl: z.string().optional(),
  // Options
  dismissible: z.boolean().default(true),
  position: z.enum(['top', 'bottom']).default('top'),
  style: z.enum(['info', 'success', 'warning', 'error', 'brand']).default('info'),
})

// Footer Section Variants
const FooterSectionVariantSchema = z.enum([
  'simple-centered',
  '4-column-simple',
  '4-column-with-company-mission',
  '4-column-with-newsletter',
  '4-column-with-call-to-action',
  'social-links-only',
  'with-sitemap',
])

export const FooterSectionBlockSchema = z.object({
  type: z.literal('footer-section'),
  variant: FooterSectionVariantSchema.default('4-column-simple'),
  // Content
  companyName: z.string(),
  companyDescription: z.string().optional(),
  logo: z.string().optional(),
  logoDark: z.string().optional(),
  copyright: z.string().optional(),
  // Navigation
  columns: z.array(z.object({
    title: z.string(),
    links: z.array(NavItemSchema),
  })).optional(),
  // Social Links
  socialLinks: z.array(z.object({
    platform: z.enum(['facebook', 'twitter', 'instagram', 'linkedin', 'github', 'youtube', 'tiktok']),
    url: z.string(),
  })).optional(),
  // Newsletter
  showNewsletter: z.boolean().optional(),
  newsletterTitle: z.string().optional(),
  newsletterSubtitle: z.string().optional(),
})

// Header Section Variants (for standalone marketing headers)
const HeaderSectionVariantSchema = z.enum([
  'simple-with-menu',
  'with-centered-logo',
  'with-full-width-flyout',
  'with-icons-flyout',
  'with-stacked-flyout',
])

export const HeaderSectionBlockSchema = z.object({
  type: z.literal('header-section'),
  variant: HeaderSectionVariantSchema.default('simple-with-menu'),
  // Branding
  companyName: z.string(),
  logo: z.string().optional(),
  logoDark: z.string().optional(),
  // Navigation
  navItems: z.array(z.object({
    label: z.string(),
    url: z.string().optional(),
    children: z.array(NavItemSchema).optional(),
  })),
  // CTA
  ctaButton: ButtonSchema.optional(),
  showLogin: z.boolean().default(true),
})

// Content Section Variants (generic content layouts)
const ContentSectionVariantSchema = z.enum([
  'centered-with-text',
  'two-column',
  'two-column-with-image',
  'with-testimonial',
  'offset-with-image',
  'with-image-grid',
  'narrow-with-features',
  'simple-three-column',
])

export const ContentSectionBlockSchema = z.object({
  type: z.literal('content-section'),
  variant: ContentSectionVariantSchema.default('centered-with-text'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  content: z.string(), // Markdown content
  // Media
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  // Optional testimonial
  testimonial: TestimonialItemSchema.optional(),
})

// Error Page Variants
const ErrorPageVariantSchema = z.enum([
  'simple-centered',
  'with-background',
  'split-with-image',
  'with-popular-pages',
  'minimal',
])

export const ErrorPageBlockSchema = z.object({
  type: z.literal('error-page'),
  variant: ErrorPageVariantSchema.default('simple-centered'),
  // Content
  errorCode: z.string().default('404'),
  title: z.string().default('Page not found'),
  description: z.string().optional(),
  // Actions
  homeButton: ButtonSchema.optional(),
  contactButton: ButtonSchema.optional(),
  // Popular pages (optional)
  popularPages: z.array(NavItemSchema).optional(),
})

// ============================================================================
// E-commerce Block Schemas
// ============================================================================

// Product schema used across e-commerce components
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  href: z.string(),
  price: z.string(),
  originalPrice: z.string().optional(),
  imageSrc: z.string(),
  imageAlt: z.string(),
  description: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().optional(),
  colors: z.array(z.object({
    name: z.string(),
    hex: z.string(),
  })).optional(),
  sizes: z.array(z.string()).optional(),
  inStock: z.boolean().optional(),
  badge: z.string().optional(),
})

// Product List Variants
const ProductListVariantSchema = z.enum([
  'simple-card-grid',
  'with-inline-price',
  'with-cta-link',
  'with-tall-images',
  'with-supporting-text',
  'card-with-full-details',
  'with-image-overlay',
  'with-color-swatches',
  'with-border-grid',
  'simple-list',
  'compact-grid',
])

export const ProductListBlockSchema = z.object({
  type: z.literal('product-list'),
  variant: ProductListVariantSchema.default('simple-card-grid'),
  // Content
  heading: z.string().optional(),
  subtitle: z.string().optional(),
  products: z.array(ProductSchema),
  // Options
  columns: z.number().min(1).max(6).default(4),
  showRating: z.boolean().optional(),
  showPrice: z.boolean().default(true),
})

// Product Overview Variants
const ProductOverviewVariantSchema = z.enum([
  'split-with-image',
  'with-image-gallery',
  'with-image-grid',
  'with-tabs',
  'with-tiered-images',
  'simple-with-details',
  'with-featured-details',
  'full-width-image',
])

export const ProductOverviewBlockSchema = z.object({
  type: z.literal('product-overview'),
  variant: ProductOverviewVariantSchema.default('split-with-image'),
  // Product
  product: ProductSchema,
  // Gallery
  images: z.array(z.object({
    src: z.string(),
    alt: z.string(),
  })).optional(),
  // Details
  features: z.array(z.string()).optional(),
  details: z.string().optional(),
  // Reviews
  reviews: z.array(z.object({
    author: z.string(),
    rating: z.number(),
    content: z.string(),
    date: z.string().optional(),
  })).optional(),
})

// Shopping Cart Variants
const ShoppingCartVariantSchema = z.enum([
  'single-column',
  'with-order-summary',
  'multi-column',
  'popover-cart',
  'slide-over',
  'with-related-products',
])

export const ShoppingCartBlockSchema = z.object({
  type: z.literal('shopping-cart'),
  variant: ShoppingCartVariantSchema.default('with-order-summary'),
  // Content
  title: z.string().default('Shopping Cart'),
  emptyMessage: z.string().default('Your cart is empty'),
  // Actions
  checkoutButton: ButtonSchema.optional(),
  continueShoppingUrl: z.string().optional(),
})

// Promo Section Variants
const PromoSectionVariantSchema = z.enum([
  'full-width-with-background',
  'with-overlapping-image-tiles',
  'with-image-tiles',
  'with-fading-background',
  'full-width-with-image',
  'with-offers-grid',
  'sale-banner',
  'with-countdown',
])

export const PromoSectionBlockSchema = z.object({
  type: z.literal('promo-section'),
  variant: PromoSectionVariantSchema.default('full-width-with-background'),
  // Content
  eyebrow: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  cta: ButtonSchema.optional(),
  // Media
  backgroundImage: z.string().optional(),
  images: z.array(z.string()).optional(),
  // Options
  offers: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    image: z.string().optional(),
    url: z.string(),
  })).optional(),
})

// ============================================================================
// Application UI Block Schemas
// ============================================================================

// Card Variants
const CardVariantSchema = z.enum([
  'simple',
  'with-header',
  'with-footer',
  'with-image',
  'with-actions',
  'horizontal',
  'with-dividers',
  'full-width-image',
  'overlay-content',
  'interactive',
])

export const CardBlockSchema = z.object({
  type: z.literal('card'),
  variant: CardVariantSchema.default('simple'),
  // Content
  title: z.string().optional(),
  subtitle: z.string().optional(),
  content: z.string().optional(),
  // Media
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  // Actions
  actions: z.array(ButtonSchema).optional(),
  // Options
  href: z.string().optional(),
})

// Data Table Variants
const DataTableVariantSchema = z.enum([
  'simple',
  'with-sorting',
  'with-pagination',
  'with-checkboxes',
  'with-sticky-header',
  'striped',
  'with-actions',
  'condensed',
  'with-avatars',
  'with-badges',
  'full-width',
  'with-expandable-rows',
  'stacked-on-mobile',
  'with-filters',
  'with-grouping',
  'with-column-borders',
  'with-vertical-lines',
  'with-hidden-columns',
  'narrow-table',
])

export const DataTableBlockSchema = z.object({
  type: z.literal('data-table'),
  variant: DataTableVariantSchema.default('simple'),
  // Structure
  columns: z.array(z.object({
    key: z.string(),
    header: z.string(),
    sortable: z.boolean().optional(),
    type: z.enum(['text', 'number', 'date', 'badge', 'avatar', 'actions']).optional(),
  })),
  // Data passed as JSON - actual data handled by component
  data: z.array(z.record(z.unknown())).optional(),
  // Options
  selectable: z.boolean().optional(),
  pagination: z.boolean().optional(),
  pageSize: z.number().optional(),
})

// Form Layout Variants
const FormLayoutVariantSchema = z.enum([
  'simple-stacked',
  'two-column',
  'with-sections',
  'card-style',
])

export const FormLayoutBlockSchema = z.object({
  type: z.literal('form-layout'),
  variant: FormLayoutVariantSchema.default('simple-stacked'),
  // Content
  title: z.string().optional(),
  description: z.string().optional(),
  // Form structure - fields defined separately, this is layout only
  sections: z.array(z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(z.string()), // Field names/IDs
  })).optional(),
  // Actions
  submitText: z.string().default('Submit'),
  cancelText: z.string().optional(),
})

// Modal Variants
const ModalVariantSchema = z.enum([
  'simple',
  'with-icon',
  'centered',
  'with-footer-actions',
  'with-close-button',
  'fullscreen',
])

export const ModalBlockSchema = z.object({
  type: z.literal('modal'),
  variant: ModalVariantSchema.default('simple'),
  // Content
  title: z.string(),
  content: z.string(),
  // Icon
  icon: z.enum(['success', 'warning', 'error', 'info', 'question']).optional(),
  // Actions
  primaryAction: ButtonSchema.optional(),
  secondaryAction: ButtonSchema.optional(),
  // Options
  dismissible: z.boolean().default(true),
})

// Alert Variants
const AlertVariantSchema = z.enum([
  'simple',
  'with-accent-border',
  'with-list',
  'with-actions',
  'with-dismiss',
  'banner-style',
])

export const AlertBlockSchema = z.object({
  type: z.literal('alert'),
  variant: AlertVariantSchema.default('simple'),
  // Content
  title: z.string().optional(),
  message: z.string(),
  items: z.array(z.string()).optional(),
  // Style
  severity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  // Options
  dismissible: z.boolean().optional(),
  actions: z.array(ButtonSchema).optional(),
})

// ============================================================================
// Union of All Blocks
// ============================================================================

export const ContentBlockSchema = z.discriminatedUnion('type', [
  // Original content blocks
  ParagraphBlockSchema,
  HeadingBlockSchema,
  HeroBlockSchema,
  ImageBlockSchema,
  GalleryBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  FAQBlockSchema,
  CalloutBlockSchema,
  EmbedBlockSchema,
  CollectionEmbedBlockSchema,
  // Marketing section blocks
  HeroSectionBlockSchema,
  FeatureSectionBlockSchema,
  PricingSectionBlockSchema,
  TestimonialSectionBlockSchema,
  CtaSectionBlockSchema,
  BlogSectionBlockSchema,
  StatsSectionBlockSchema,
  TeamSectionBlockSchema,
  NewsletterSectionBlockSchema,
  ContactSectionBlockSchema,
  FaqSectionBlockSchema,
  LogoCloudSectionBlockSchema,
  BentoGridSectionBlockSchema,
  BannerBlockSchema,
  FooterSectionBlockSchema,
  HeaderSectionBlockSchema,
  ContentSectionBlockSchema,
  ErrorPageBlockSchema,
  // E-commerce blocks
  ProductListBlockSchema,
  ProductOverviewBlockSchema,
  ShoppingCartBlockSchema,
  PromoSectionBlockSchema,
  // Application UI blocks
  CardBlockSchema,
  DataTableBlockSchema,
  FormLayoutBlockSchema,
  ModalBlockSchema,
  AlertBlockSchema,
])

export const ContentBlocksSchema = z.array(ContentBlockSchema)

// ============================================================================
// TypeScript Types
// ============================================================================

// Original block types
export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>
export type HeadingBlock = z.infer<typeof HeadingBlockSchema>
export type HeroBlock = z.infer<typeof HeroBlockSchema>
export type ImageBlock = z.infer<typeof ImageBlockSchema>
export type GalleryBlock = z.infer<typeof GalleryBlockSchema>
export type QuoteBlock = z.infer<typeof QuoteBlockSchema>
export type ListBlock = z.infer<typeof ListBlockSchema>
export type FAQBlock = z.infer<typeof FAQBlockSchema>
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>
export type CollectionEmbedBlock = z.infer<typeof CollectionEmbedBlockSchema>

// Marketing section block types
export type HeroSectionBlock = z.infer<typeof HeroSectionBlockSchema>
export type FeatureSectionBlock = z.infer<typeof FeatureSectionBlockSchema>
export type PricingSectionBlock = z.infer<typeof PricingSectionBlockSchema>
export type TestimonialSectionBlock = z.infer<typeof TestimonialSectionBlockSchema>
export type CtaSectionBlock = z.infer<typeof CtaSectionBlockSchema>
export type BlogSectionBlock = z.infer<typeof BlogSectionBlockSchema>
export type StatsSectionBlock = z.infer<typeof StatsSectionBlockSchema>
export type TeamSectionBlock = z.infer<typeof TeamSectionBlockSchema>
export type NewsletterSectionBlock = z.infer<typeof NewsletterSectionBlockSchema>
export type ContactSectionBlock = z.infer<typeof ContactSectionBlockSchema>
export type FaqSectionBlock = z.infer<typeof FaqSectionBlockSchema>
export type LogoCloudSectionBlock = z.infer<typeof LogoCloudSectionBlockSchema>
export type BentoGridSectionBlock = z.infer<typeof BentoGridSectionBlockSchema>
export type BannerBlock = z.infer<typeof BannerBlockSchema>
export type FooterSectionBlock = z.infer<typeof FooterSectionBlockSchema>
export type HeaderSectionBlock = z.infer<typeof HeaderSectionBlockSchema>
export type ContentSectionBlock = z.infer<typeof ContentSectionBlockSchema>
export type ErrorPageBlock = z.infer<typeof ErrorPageBlockSchema>

// E-commerce block types
export type ProductListBlock = z.infer<typeof ProductListBlockSchema>
export type ProductOverviewBlock = z.infer<typeof ProductOverviewBlockSchema>
export type ShoppingCartBlock = z.infer<typeof ShoppingCartBlockSchema>
export type PromoSectionBlock = z.infer<typeof PromoSectionBlockSchema>

// Application UI block types
export type CardBlock = z.infer<typeof CardBlockSchema>
export type DataTableBlock = z.infer<typeof DataTableBlockSchema>
export type FormLayoutBlock = z.infer<typeof FormLayoutBlockSchema>
export type ModalBlock = z.infer<typeof ModalBlockSchema>
export type AlertBlock = z.infer<typeof AlertBlockSchema>

// Union types
export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type ContentBlocks = z.infer<typeof ContentBlocksSchema>

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate an array of content blocks
 * @throws ZodError if validation fails
 */
export function validateContentBlocks(blocks: unknown): ContentBlocks {
  return ContentBlocksSchema.parse(blocks)
}

/**
 * Safely validate content blocks
 * Returns { success: true, data } or { success: false, error }
 */
export function safeValidateContentBlocks(blocks: unknown) {
  return ContentBlocksSchema.safeParse(blocks)
}
