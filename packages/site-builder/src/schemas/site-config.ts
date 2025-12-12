/**
 * Zod schemas for site.json configuration
 * Defines theme, layout, SEO, and feature settings for a website
 */

import { z } from 'zod'

// =============================================================================
// COLOR SCHEMAS
// =============================================================================

/**
 * Color scale (50-900) for primary/secondary colors
 */
export const ColorScaleSchema = z.object({
  '50': z.string().optional(),
  '100': z.string().optional(),
  '200': z.string().optional(),
  '300': z.string().optional(),
  '400': z.string().optional(),
  '500': z.string(),  // Required - main color
  '600': z.string().optional(),
  '700': z.string().optional(),
  '800': z.string().optional(),
  '900': z.string().optional(),
})

export const ThemeColorsSchema = z.object({
  primary: ColorScaleSchema,
  secondary: ColorScaleSchema.optional(),
  accent: z.string().optional(),
  // Allow custom color definitions
}).passthrough()

// =============================================================================
// TYPOGRAPHY SCHEMAS
// =============================================================================

export const ThemeFontsSchema = z.object({
  sans: z.string().default('system-ui, sans-serif'),
  serif: z.string().optional(),
  mono: z.string().optional(),
  display: z.string().optional(),  // For headings/hero text
})

// =============================================================================
// THEME SCHEMA
// =============================================================================

export const ThemeConfigSchema = z.object({
  extends: z.string().optional(),  // Base theme to extend (e.g., "default", "dark")
  colors: ThemeColorsSchema,
  fonts: ThemeFontsSchema.optional(),
  borderRadius: z.string().default('0.5rem'),
  shadows: z.enum(['none', 'sm', 'default', 'lg']).default('default'),
})

// =============================================================================
// LAYOUT SCHEMAS
// =============================================================================

export const HeaderLayoutSchema = z.object({
  variant: z.string().default('simple'),  // e.g., "simple", "centered", "mega-menu"
  sticky: z.boolean().default(true),
  transparent_on_hero: z.boolean().default(false),
  show_cta_button: z.boolean().default(false),
})

export const FooterLayoutSchema = z.object({
  variant: z.string().default('four-column'),  // e.g., "simple", "four-column", "centered"
  show_social: z.boolean().default(true),
  show_newsletter: z.boolean().default(false),
})

export const ContainerLayoutSchema = z.object({
  max_width: z.enum(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full']).default('7xl'),
  padding: z.string().default('4'),  // Tailwind padding scale
})

export const LayoutConfigSchema = z.object({
  header: HeaderLayoutSchema.default({}),
  footer: FooterLayoutSchema.default({}),
  container: ContainerLayoutSchema.default({}),
})

// =============================================================================
// SEO SCHEMAS
// =============================================================================

export const StructuredDataSchema = z.object({
  organization: z.object({
    '@type': z.literal('Organization'),
    name: z.string(),
    url: z.string().url(),
    logo: z.string().url().optional(),
    sameAs: z.array(z.string().url()).optional(),
  }).optional(),
}).passthrough()

export const SeoConfigSchema = z.object({
  default_og_image: z.string().optional(),
  twitter_handle: z.string().optional(),
  google_site_verification: z.string().optional(),
  structured_data: StructuredDataSchema.optional(),
})

// =============================================================================
// ANALYTICS SCHEMAS
// =============================================================================

export const AnalyticsConfigSchema = z.object({
  google_analytics_id: z.string().optional(),
  google_tag_manager_id: z.string().optional(),
  plausible_domain: z.string().optional(),
  fathom_site_id: z.string().optional(),
})

// =============================================================================
// FEATURES SCHEMA
// =============================================================================

export const FeaturesConfigSchema = z.object({
  dark_mode: z.boolean().default(false),
  search: z.boolean().default(false),
  breadcrumbs: z.boolean().default(true),
  reading_time: z.boolean().default(false),
  share_buttons: z.boolean().default(false),
  table_of_contents: z.boolean().default(false),
  comments: z.boolean().default(false),
})

// =============================================================================
// SITE INFO SCHEMA
// =============================================================================

export const SiteInfoSchema = z.object({
  name: z.string(),  // Short name (used in nav, footer)
  title: z.string(),  // Full title (used in <title> tag)
  tagline: z.string().optional(),  // Site description/tagline
  logo: z.string().optional(),  // Logo URL or path
  favicon: z.string().optional(),  // Favicon path
  base_url: z.string().url(),  // Production URL
  default_language: z.string().default('en'),
  languages: z.array(z.string()).default(['en']),
})

// =============================================================================
// MAIN SITE CONFIG SCHEMA
// =============================================================================

export const SiteConfigSchema = z.object({
  $schema: z.string().optional(),  // JSON Schema reference
  version: z.string().default('1.0.0'),
  site: SiteInfoSchema,
  theme: ThemeConfigSchema,
  layout: LayoutConfigSchema.default({}),
  seo: SeoConfigSchema.default({}),
  analytics: AnalyticsConfigSchema.default({}),
  features: FeaturesConfigSchema.default({}),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ColorScale = z.infer<typeof ColorScaleSchema>
export type ThemeColors = z.infer<typeof ThemeColorsSchema>
export type ThemeFonts = z.infer<typeof ThemeFontsSchema>
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>
export type HeaderLayout = z.infer<typeof HeaderLayoutSchema>
export type FooterLayout = z.infer<typeof FooterLayoutSchema>
export type ContainerLayout = z.infer<typeof ContainerLayoutSchema>
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>
export type SeoConfig = z.infer<typeof SeoConfigSchema>
export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>
export type SiteInfo = z.infer<typeof SiteInfoSchema>
export type SiteConfig = z.infer<typeof SiteConfigSchema>
