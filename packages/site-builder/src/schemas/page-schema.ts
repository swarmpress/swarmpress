/**
 * Zod schemas for i18n Page structure
 * Single page file with inline translations for all languages
 */

import { z } from 'zod'

// =============================================================================
// LOCALIZED TYPES
// =============================================================================

/**
 * Localized string - map of language code to translated text
 * Example: { "en": "Hello", "de": "Hallo", "fr": "Bonjour", "it": "Ciao" }
 */
export const LocalizedStringSchema = z.record(z.string(), z.string())

/**
 * Localized URL - language-specific slugs
 * Example: { "en": "/en/monterosso/overview", "de": "/de/monterosso/ueberblick" }
 */
export const LocalizedSlugSchema = z.record(z.string(), z.string())

/**
 * Localized array of strings (for keywords, etc.)
 */
export const LocalizedStringArraySchema = z.record(z.string(), z.array(z.string()))

// =============================================================================
// SEO SCHEMA (Localized)
// =============================================================================

export const LocalizedSeoSchema = z.object({
  title: LocalizedStringSchema,
  description: LocalizedStringSchema,
  keywords: LocalizedStringArraySchema.optional(),
  og_image: z.string().optional(),  // Same image for all languages
})

// =============================================================================
// BUTTON SCHEMA (Localized)
// =============================================================================

export const LocalizedButtonSchema = z.object({
  text: LocalizedStringSchema,
  url: LocalizedSlugSchema,  // URLs can be localized too
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost']).default('primary'),
})

// Simple button for non-localized contexts (internal use)
export const SimpleButtonSchema = z.object({
  text: z.string(),
  url: z.string(),
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost']).default('primary'),
})

// =============================================================================
// SECTION BLOCK SCHEMAS (Localized)
// =============================================================================

/**
 * Hero Section
 */
export const HeroSectionSchema = z.object({
  type: z.literal('hero-section'),
  variant: z.string().default('split-with-image'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema,
  subtitle: LocalizedStringSchema.optional(),
  buttons: z.array(LocalizedButtonSchema).optional(),
  image: z.string().optional(),  // Image URL (same for all languages)
})

/**
 * Stats Section
 */
export const StatItemSchema = z.object({
  value: z.string(),  // Numbers don't need translation
  label: LocalizedStringSchema,
})

export const StatsSectionSchema = z.object({
  type: z.literal('stats-section'),
  variant: z.string().default('simple-grid'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  stats: z.array(StatItemSchema),
})

/**
 * Feature Section
 */
export const FeatureItemSchema = z.object({
  icon: z.string().optional(),
  title: LocalizedStringSchema,
  description: LocalizedStringSchema,
  url: LocalizedSlugSchema.optional(),
})

export const FeatureSectionSchema = z.object({
  type: z.literal('feature-section'),
  variant: z.string().default('simple-3x2-grid'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  description: LocalizedStringSchema.optional(),
  features: z.array(FeatureItemSchema),
})

/**
 * CTA Section
 */
export const CtaSectionSchema = z.object({
  type: z.literal('cta-section'),
  variant: z.string().default('simple-centered'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema,
  subtitle: LocalizedStringSchema.optional(),
  buttons: z.array(LocalizedButtonSchema).optional(),
})

/**
 * FAQ Section
 */
export const FaqItemSchema = z.object({
  question: LocalizedStringSchema,
  answer: LocalizedStringSchema,
})

export const FaqSectionSchema = z.object({
  type: z.literal('faq-section'),
  variant: z.string().default('centered'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  description: LocalizedStringSchema.optional(),
  faqs: z.array(FaqItemSchema),
})

/**
 * Content Section (rich text/paragraphs)
 */
export const ContentSectionSchema = z.object({
  type: z.literal('content-section'),
  variant: z.string().default('prose'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  content: LocalizedStringSchema,  // Markdown content
})

/**
 * Gallery Section
 */
export const GalleryImageSchema = z.object({
  src: z.string(),
  alt: LocalizedStringSchema,
  caption: LocalizedStringSchema.optional(),
})

export const GallerySectionSchema = z.object({
  type: z.literal('gallery-section'),
  variant: z.string().default('grid'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  images: z.array(GalleryImageSchema),
})

/**
 * Testimonial Section
 */
export const TestimonialItemSchema = z.object({
  quote: LocalizedStringSchema,
  author: z.string(),  // Names don't need translation
  role: LocalizedStringSchema.optional(),
  avatar: z.string().optional(),
})

export const TestimonialSectionSchema = z.object({
  type: z.literal('testimonial-section'),
  variant: z.string().default('centered'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  testimonials: z.array(TestimonialItemSchema),
})

/**
 * Pricing Section
 */
export const PricingTierSchema = z.object({
  name: LocalizedStringSchema,
  price: z.string(),  // Formatted price string
  period: LocalizedStringSchema.optional(),
  description: LocalizedStringSchema.optional(),
  features: z.array(LocalizedStringSchema),
  cta: LocalizedButtonSchema.optional(),
  highlighted: z.boolean().default(false),
})

export const PricingSectionSchema = z.object({
  type: z.literal('pricing-section'),
  variant: z.string().default('three-tiers'),
  eyebrow: LocalizedStringSchema.optional(),
  title: LocalizedStringSchema.optional(),
  description: LocalizedStringSchema.optional(),
  tiers: z.array(PricingTierSchema),
})

/**
 * Footer Section
 */
export const FooterLinkSchema = z.object({
  label: LocalizedStringSchema,
  url: LocalizedSlugSchema,
})

export const FooterColumnSchema = z.object({
  title: LocalizedStringSchema,
  links: z.array(FooterLinkSchema),
})

export const SocialLinkSchema = z.object({
  platform: z.string(),
  url: z.string(),
})

export const FooterSectionSchema = z.object({
  type: z.literal('footer-section'),
  variant: z.string().default('4-column-simple'),
  companyName: z.string(),
  companyDescription: LocalizedStringSchema.optional(),
  copyright: LocalizedStringSchema.optional(),
  columns: z.array(FooterColumnSchema).optional(),
  socialLinks: z.array(SocialLinkSchema).optional(),
})

/**
 * Header Section
 */
export const HeaderSectionSchema = z.object({
  type: z.literal('header-section'),
  variant: z.string().default('simple'),
  logo: z.string().optional(),
  logoText: z.string().optional(),
  navItems: z.array(z.object({
    label: LocalizedStringSchema,
    url: LocalizedSlugSchema,
  })).optional(),
  cta: LocalizedButtonSchema.optional(),
})

// =============================================================================
// UNION OF ALL SECTION TYPES
// =============================================================================

export const SectionBlockSchema = z.discriminatedUnion('type', [
  HeroSectionSchema,
  StatsSectionSchema,
  FeatureSectionSchema,
  CtaSectionSchema,
  FaqSectionSchema,
  ContentSectionSchema,
  GallerySectionSchema,
  TestimonialSectionSchema,
  PricingSectionSchema,
  FooterSectionSchema,
  HeaderSectionSchema,
])

// =============================================================================
// PAGE SCHEMA
// =============================================================================

export const PageMetadataSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  page_type: z.string().optional(),
  template: z.string().optional(),
  // Languages are now implicit in the localized fields
})

export const PageSchema = z.object({
  id: z.string().uuid(),

  /**
   * Localized slugs for each language
   * { "en": "/en/monterosso/overview", "de": "/de/monterosso/ueberblick" }
   */
  slug: LocalizedSlugSchema,

  /**
   * Page title (localized)
   */
  title: LocalizedStringSchema,

  /**
   * Page type for template matching
   */
  page_type: z.string(),

  /**
   * SEO metadata (localized)
   */
  seo: LocalizedSeoSchema,

  /**
   * Page body - array of section blocks with localized content
   */
  body: z.array(SectionBlockSchema),

  /**
   * Additional metadata
   */
  metadata: PageMetadataSchema.optional(),

  /**
   * Publishing status
   */
  status: z.enum(['draft', 'published', 'archived']).default('draft'),

  /**
   * Timestamps
   */
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type LocalizedString = z.infer<typeof LocalizedStringSchema>
export type LocalizedSlug = z.infer<typeof LocalizedSlugSchema>
export type LocalizedSeo = z.infer<typeof LocalizedSeoSchema>
export type LocalizedButton = z.infer<typeof LocalizedButtonSchema>

export type HeroSection = z.infer<typeof HeroSectionSchema>
export type StatsSection = z.infer<typeof StatsSectionSchema>
export type FeatureSection = z.infer<typeof FeatureSectionSchema>
export type CtaSection = z.infer<typeof CtaSectionSchema>
export type FaqSection = z.infer<typeof FaqSectionSchema>
export type ContentSection = z.infer<typeof ContentSectionSchema>
export type GallerySection = z.infer<typeof GallerySectionSchema>
export type TestimonialSection = z.infer<typeof TestimonialSectionSchema>
export type PricingSection = z.infer<typeof PricingSectionSchema>
export type FooterSection = z.infer<typeof FooterSectionSchema>
export type HeaderSection = z.infer<typeof HeaderSectionSchema>

export type SectionBlock = z.infer<typeof SectionBlockSchema>
export type Page = z.infer<typeof PageSchema>
export type PageMetadata = z.infer<typeof PageMetadataSchema>
