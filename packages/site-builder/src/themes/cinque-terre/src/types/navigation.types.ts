/**
 * Coastal Spine Navigation System - Type Definitions
 *
 * This file defines the TypeScript interfaces for the geographic navigation
 * system based on the Cinque Terre coastline.
 */

// Supported languages for the site
export type SupportedLanguage = 'en' | 'de' | 'fr' | 'it';

// The five villages in geographic order (south to north)
export type VillageSlug =
  | 'riomaggiore'
  | 'manarola'
  | 'corniglia'
  | 'vernazza'
  | 'monterosso';

// Available content sections per village
export type SectionSlug =
  | 'overview'
  | 'things-to-do'
  | 'restaurants'
  | 'hotels'
  | 'apartments'
  | 'sights'
  | 'hiking'
  | 'beaches'
  | 'events'
  | 'weather'
  | 'getting-here'
  | 'boat-tours'
  | 'culinary'
  | 'blog'
  | 'faq'
  | 'maps';

// Village definition with translations
export interface Village {
  slug: VillageSlug;
  name: Record<SupportedLanguage, string>;
  order: number; // Geographic order: 1=Riomaggiore (south), 5=Monterosso (north)
  color: string; // CSS custom property or color value
}

// Section definition with translations and display options
export interface Section {
  slug: SectionSlug;
  name: Record<SupportedLanguage, string>;
  icon: string; // Lucide icon name
  order: number; // Display order in nav
  showInNav: boolean; // Whether to show in main navigation
  /** URL path for hub page (e.g., 'culinary' for /en/culinary). If not set, uses slug. */
  hubPath?: string;
}

// Navigation state derived from URL
export interface NavigationState {
  currentLang: SupportedLanguage;
  activeVillage: VillageSlug | null; // null = homepage or hub page
  activeSection: SectionSlug | null;
  isHubPage: boolean; // true for aggregated pages like /en/restaurants
}

// Props for the main CoastalSpine component
export interface CoastalSpineProps {
  currentPath: string;
  locale: SupportedLanguage;
}

// Props for individual village nodes
export interface VillageNodeProps {
  village: Village;
  isActive: boolean; // From URL
  isExpanded: boolean; // From hover or URL
  sections: Section[];
  activeSection: SectionSlug | null;
  locale: SupportedLanguage;
  onHover?: () => void;
  onLeave?: () => void;
}

// Props for section navigation dropdown
export interface SectionNavProps {
  village: VillageSlug;
  sections: Section[];
  activeSection: SectionSlug | null;
  locale: SupportedLanguage;
  isVisible: boolean;
}

// Props for language switcher
export interface LanguageSwitcherProps {
  currentLang: SupportedLanguage;
  currentPath: string;
}

// Props for mobile navigation
export interface MobileNavProps {
  currentPath: string;
  locale: SupportedLanguage;
}

// Feature flags for gradual rollout
export interface FeatureFlags {
  useCoastalSpineNav: boolean;
  useVillageScopedUrls: boolean;
  showLanguageSwitcher: boolean;
  enableMobileBottomNav: boolean;
}
