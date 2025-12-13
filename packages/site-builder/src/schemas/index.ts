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

// Page schema (i18n pages with inline translations)
export {
  // Core schemas
  PageSchema,
  LocalizedSlugSchema,
  LocalizedSeoSchema,
  LocalizedButtonSchema,
  PageMetadataSchema,
  // Section schemas
  SectionBlockSchema,
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
  // Types
  type Page,
  type LocalizedSlug,
  type LocalizedSeo,
  type LocalizedButton,
  type PageMetadata,
  type SectionBlock,
  type HeroSection,
  type StatsSection,
  type FeatureSection,
  type CtaSection,
  type FaqSection,
  type ContentSection,
  type GallerySection,
  type TestimonialSection,
  type PricingSection,
  type FooterSection,
  type HeaderSection,
} from './page-schema'

// Blueprint schema (page templates for content generation)
export {
  // Schemas
  BlueprintSchema,
  BlueprintComponentSchema,
  AIHintsSchema,
  CollectionSourceSchema,
  LinkingRulesSchema,
  SEOTemplateSchema,
  DisplayPropsSchema,
  ComponentPropsSchema,
  // Types
  type Blueprint,
  type BlueprintComponent,
  type AIHints,
  type CollectionSource,
  type LinkingRules,
  type SEOTemplate,
  type ComponentProps,
  // Helpers
  validateBlueprint,
  validateBlueprintComponent,
  getDefaultAIHints,
  getComponentFileName,
} from './blueprint-schema'
