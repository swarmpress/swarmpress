/**
 * Configuration Schemas
 * Zod schemas for validating site configuration files
 */

// Site configuration (site.json)
export {
  // Schemas
  SiteConfigSchema,
  SiteInfoSchema,
  ThemeConfigSchema,
  ThemeColorsSchema,
  ThemeFontsSchema,
  ColorScaleSchema,
  LayoutConfigSchema,
  HeaderLayoutSchema,
  FooterLayoutSchema,
  ContainerLayoutSchema,
  SeoConfigSchema,
  AnalyticsConfigSchema,
  FeaturesConfigSchema,
  // Types
  type SiteConfig,
  type SiteInfo,
  type ThemeConfig,
  type ThemeColors,
  type ThemeFonts,
  type ColorScale,
  type LayoutConfig,
  type HeaderLayout,
  type FooterLayout,
  type ContainerLayout,
  type SeoConfig,
  type AnalyticsConfig,
  type FeaturesConfig,
} from './site-config'

// Navigation configuration (navigation.json)
export {
  // Schemas
  NavigationConfigSchema,
  NavItemSchema,
  NavLinkSchema,
  FooterNavSectionSchema,
  SocialLinkSchema,
  SocialPlatformSchema,
  CtaButtonSchema,
  LocalizedStringSchema,
  // Types
  type NavigationConfig,
  type NavItem,
  type NavLink,
  type FooterNavSection,
  type SocialLink,
  type SocialPlatform,
  type CtaButton,
} from './navigation-config'
