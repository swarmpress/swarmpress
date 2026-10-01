/**
 * Zod schemas for navigation.json configuration
 * Defines header nav, footer nav, and social links
 */

import { z } from 'zod'

// =============================================================================
// NAVIGATION ITEM SCHEMAS
// =============================================================================

/**
 * Localized string - supports multiple languages
 */
export const LocalizedStringSchema = z.record(z.string(), z.string())

/**
 * Single navigation link
 */
export const NavLinkSchema = z.object({
  title: z.string(),
  titles: LocalizedStringSchema.optional(),  // Translated titles
  url: z.string(),
  external: z.boolean().default(false),  // Opens in new tab
  highlight: z.boolean().default(false),  // Visual emphasis
  icon: z.string().optional(),  // Icon name/path
})

/**
 * Navigation item with optional children (for dropdowns/mega-menus)
 */
export const NavItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    title: z.string(),
    titles: LocalizedStringSchema.optional(),
    url: z.string().optional(),  // Optional if has children
    external: z.boolean().default(false),
    highlight: z.boolean().default(false),
    icon: z.string().optional(),
    description: z.string().optional(),  // For mega-menu descriptions
    children: z.array(NavItemSchema).optional(),
  })
)

// Interface for recursive type
interface NavItem {
  title: string
  titles?: Record<string, string>
  url?: string
  external?: boolean
  highlight?: boolean
  icon?: string
  description?: string
  children?: NavItem[]
}

// =============================================================================
// FOOTER NAVIGATION SCHEMAS
// =============================================================================

/**
 * Footer navigation section (group of links)
 */
export const FooterNavSectionSchema = z.object({
  title: z.string(),
  titles: LocalizedStringSchema.optional(),
  links: z.array(NavLinkSchema),
})

// =============================================================================
// SOCIAL LINKS SCHEMA
// =============================================================================

export const SocialPlatformSchema = z.enum([
  'twitter',
  'facebook',
  'instagram',
  'linkedin',
  'youtube',
  'tiktok',
  'github',
  'discord',
  'mastodon',
  'threads',
  'bluesky',
  'rss',
])

export const SocialLinkSchema = z.object({
  platform: SocialPlatformSchema,
  url: z.string().url(),
  label: z.string().optional(),  // Accessibility label
})

// =============================================================================
// CTA BUTTON SCHEMA
// =============================================================================

export const CtaButtonSchema = z.object({
  text: z.string(),
  texts: LocalizedStringSchema.optional(),
  url: z.string(),
  variant: z.enum(['primary', 'secondary', 'outline', 'ghost']).default('primary'),
  external: z.boolean().default(false),
})

// =============================================================================
// MAIN NAVIGATION CONFIG SCHEMA
// =============================================================================

export const NavigationConfigSchema = z.object({
  $schema: z.string().optional(),

  /**
   * Main header navigation items
   */
  main_nav: z.array(NavItemSchema).default([]),

  /**
   * Footer navigation sections
   */
  footer_nav: z.array(FooterNavSectionSchema).default([]),

  /**
   * Social media links (shown in header/footer)
   */
  social_links: z.array(SocialLinkSchema).default([]),

  /**
   * Call-to-action button (shown in header)
   */
  cta_button: CtaButtonSchema.optional(),

  /**
   * Legal/utility links (privacy, terms, etc.)
   */
  legal_links: z.array(NavLinkSchema).default([]),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type NavLink = z.infer<typeof NavLinkSchema>
// NavItem is exported from the interface above
export type { NavItem }
export type FooterNavSection = z.infer<typeof FooterNavSectionSchema>
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>
export type SocialLink = z.infer<typeof SocialLinkSchema>
export type CtaButton = z.infer<typeof CtaButtonSchema>
export type NavigationConfig = z.infer<typeof NavigationConfigSchema>
