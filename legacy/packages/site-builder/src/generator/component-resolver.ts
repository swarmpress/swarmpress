/**
 * Component Resolver
 * Resolves component variants based on configuration
 */

import type { HeaderLayout, FooterLayout } from '../schemas'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Component categories available for resolution
 */
export type ComponentCategory = 'header' | 'footer' | 'hero' | 'features' | 'cta' | 'testimonials'

/**
 * Resolved component information
 */
export interface ResolvedComponent {
  /** Component file name (e.g., 'HeaderSimple') */
  componentName: string
  /** Import path relative to components directory */
  importPath: string
  /** Full file path for the .astro file */
  filePath: string
}

// =============================================================================
// VARIANT MAPPINGS
// =============================================================================

/**
 * Header variant to component mapping
 */
export const HEADER_COMPONENTS: Record<string, ResolvedComponent> = {
  simple: {
    componentName: 'HeaderSimple',
    importPath: '../components/layout/header/HeaderSimple.astro',
    filePath: 'components/layout/header/HeaderSimple.astro',
  },
  'mega-menu': {
    componentName: 'HeaderMegaMenu',
    importPath: '../components/layout/header/HeaderMegaMenu.astro',
    filePath: 'components/layout/header/HeaderMegaMenu.astro',
  },
  centered: {
    componentName: 'HeaderCentered',
    importPath: '../components/layout/header/HeaderCentered.astro',
    filePath: 'components/layout/header/HeaderCentered.astro',
  },
}

/**
 * Footer variant to component mapping
 */
export const FOOTER_COMPONENTS: Record<string, ResolvedComponent> = {
  'four-column': {
    componentName: 'FooterFourColumn',
    importPath: '../components/layout/footer/FooterFourColumn.astro',
    filePath: 'components/layout/footer/FooterFourColumn.astro',
  },
  simple: {
    componentName: 'FooterSimple',
    importPath: '../components/layout/footer/FooterSimple.astro',
    filePath: 'components/layout/footer/FooterSimple.astro',
  },
  centered: {
    componentName: 'FooterCentered',
    importPath: '../components/layout/footer/FooterCentered.astro',
    filePath: 'components/layout/footer/FooterCentered.astro',
  },
}

/**
 * Hero variant to component mapping
 */
export const HERO_COMPONENTS: Record<string, ResolvedComponent> = {
  centered: {
    componentName: 'HeroCentered',
    importPath: '../components/marketing/hero/HeroCentered.astro',
    filePath: 'components/marketing/hero/HeroCentered.astro',
  },
  split: {
    componentName: 'HeroSplit',
    importPath: '../components/marketing/hero/HeroSplit.astro',
    filePath: 'components/marketing/hero/HeroSplit.astro',
  },
  simple: {
    componentName: 'HeroSimple',
    importPath: '../components/marketing/hero/HeroSimple.astro',
    filePath: 'components/marketing/hero/HeroSimple.astro',
  },
  'with-app-screenshot': {
    componentName: 'HeroWithAppScreenshot',
    importPath: '../components/marketing/hero/HeroWithAppScreenshot.astro',
    filePath: 'components/marketing/hero/HeroWithAppScreenshot.astro',
  },
}

// =============================================================================
// RESOLVER FUNCTIONS
// =============================================================================

/**
 * Resolve header component from layout config
 */
export function resolveHeaderComponent(header: HeaderLayout): ResolvedComponent {
  const variant = header.variant || 'simple'
  return HEADER_COMPONENTS[variant] ?? HEADER_COMPONENTS['simple']!
}

/**
 * Resolve footer component from layout config
 */
export function resolveFooterComponent(footer: FooterLayout): ResolvedComponent {
  const variant = footer.variant || 'four-column'
  return FOOTER_COMPONENTS[variant] ?? FOOTER_COMPONENTS['four-column']!
}

/**
 * Resolve hero component from variant string
 */
export function resolveHeroComponent(variant: string = 'centered'): ResolvedComponent {
  return HERO_COMPONENTS[variant] ?? HERO_COMPONENTS['centered']!
}

/**
 * Generic component resolver
 */
export function resolveComponent(
  category: ComponentCategory,
  variant: string
): ResolvedComponent | null {
  switch (category) {
    case 'header':
      return HEADER_COMPONENTS[variant] || null
    case 'footer':
      return FOOTER_COMPONENTS[variant] || null
    case 'hero':
      return HERO_COMPONENTS[variant] || null
    default:
      return null
  }
}

// =============================================================================
// COMPONENT PROPS HELPERS
// =============================================================================

/**
 * Build header component props from site config
 */
export function buildHeaderProps(
  siteInfo: { name: string; logo?: string; base_url: string; default_language?: string },
  navigation: { main_nav: unknown[]; cta_button?: unknown },
  layout: { header?: HeaderLayout }
): Record<string, unknown> {
  return {
    siteName: siteInfo.name,
    logo: siteInfo.logo,
    baseUrl: siteInfo.base_url,
    navItems: navigation.main_nav,
    ctaButton: navigation.cta_button,
    sticky: layout.header?.sticky ?? false,
    transparentOnHero: layout.header?.transparent_on_hero ?? false,
    lang: siteInfo.default_language || 'en',
  }
}

/**
 * Build footer component props from site config
 */
export function buildFooterProps(
  siteInfo: { name: string; logo?: string },
  navigation: { footer_nav: unknown[]; social_links: unknown[]; legal_links: unknown[] },
  layout: { footer?: FooterLayout }
): Record<string, unknown> {
  return {
    siteName: siteInfo.name,
    logo: siteInfo.logo,
    footerNav: navigation.footer_nav,
    socialLinks: navigation.social_links,
    legalLinks: navigation.legal_links,
    showNewsletter: layout.footer?.show_newsletter ?? false,
  }
}

// =============================================================================
// IMPORT GENERATION
// =============================================================================

/**
 * Generate Astro import statement for a component
 */
export function generateImportStatement(component: ResolvedComponent): string {
  return `import ${component.componentName} from '${component.importPath}'`
}

/**
 * Get all available component variants for a category
 */
export function getAvailableVariants(category: ComponentCategory): string[] {
  switch (category) {
    case 'header':
      return Object.keys(HEADER_COMPONENTS)
    case 'footer':
      return Object.keys(FOOTER_COMPONENTS)
    case 'hero':
      return Object.keys(HERO_COMPONENTS)
    default:
      return []
  }
}
