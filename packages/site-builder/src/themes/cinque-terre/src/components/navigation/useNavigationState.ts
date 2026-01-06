/**
 * Navigation State Hook
 *
 * Parses the current URL to derive navigation state.
 * Supports both legacy flat URLs and new village-scoped URLs.
 */

import { useMemo } from 'react';
import type {
  NavigationState,
  SupportedLanguage,
  VillageSlug,
  SectionSlug,
} from '../../types/navigation.types';
import {
  VILLAGES,
  SECTIONS,
  SUPPORTED_LANGUAGES,
  isVillageSlug,
  isSectionSlug,
  isSupportedLanguage,
} from '../../config/navigation.config';

/**
 * Parse a URL pathname to derive navigation state.
 *
 * Handles multiple URL patterns:
 * - Homepage: /{lang}/ or /
 * - Hub page: /{lang}/{section} (e.g., /en/restaurants)
 * - Village root: /{lang}/{village} (e.g., /en/riomaggiore)
 * - Village section: /{lang}/{village}/{section} (e.g., /en/riomaggiore/restaurants)
 *
 * @param pathname - The URL pathname to parse
 * @returns NavigationState object with current context
 */
export function parseNavigationState(pathname: string): NavigationState {
  // Default state for homepage
  const defaultState: NavigationState = {
    currentLang: 'en',
    activeVillage: null,
    activeSection: null,
    isHubPage: false,
  };

  // Remove leading/trailing slashes and split into segments
  const segments = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  // No segments = root homepage
  if (segments.length === 0) {
    return defaultState;
  }

  // First segment should be language
  const [first, second, third] = segments;

  // Validate language
  const currentLang: SupportedLanguage = isSupportedLanguage(first)
    ? first
    : 'en';

  // Just language = homepage for that language
  if (segments.length === 1) {
    return {
      ...defaultState,
      currentLang,
    };
  }

  // Check if second segment is a village or a section
  if (isVillageSlug(second)) {
    // Village-scoped URL: /{lang}/{village} or /{lang}/{village}/{section}
    const activeVillage = second as VillageSlug;

    // Check for section in third segment
    if (third && isSectionSlug(third)) {
      return {
        currentLang,
        activeVillage,
        activeSection: third as SectionSlug,
        isHubPage: false,
      };
    }

    // Village root = overview section
    return {
      currentLang,
      activeVillage,
      activeSection: 'overview',
      isHubPage: false,
    };
  }

  // Check if second segment is a section (hub page)
  if (isSectionSlug(second)) {
    return {
      currentLang,
      activeVillage: null,
      activeSection: second as SectionSlug,
      isHubPage: true,
    };
  }

  // Unknown second segment - treat as homepage with just language
  return {
    ...defaultState,
    currentLang,
  };
}

/**
 * React hook for navigation state.
 * Memoizes the parsing result for performance.
 *
 * @param pathname - The current URL pathname
 * @returns NavigationState derived from the URL
 */
export function useNavigationState(pathname: string): NavigationState {
  return useMemo(() => parseNavigationState(pathname), [pathname]);
}

/**
 * Build a URL for a village section.
 *
 * @param lang - Target language
 * @param village - Village slug
 * @param section - Optional section slug (omit for village overview)
 * @returns Formatted URL path
 */
export function buildVillageUrl(
  lang: SupportedLanguage,
  village: VillageSlug,
  section?: SectionSlug
): string {
  // Overview section goes to village root
  if (!section || section === 'overview') {
    return `/${lang}/${village}`;
  }
  return `/${lang}/${village}/${section}`;
}

/**
 * Build a URL for a hub page (aggregated across all villages).
 *
 * @param lang - Target language
 * @param section - Section slug
 * @returns Formatted URL path
 */
export function buildHubUrl(
  lang: SupportedLanguage,
  section: SectionSlug
): string {
  return `/${lang}/${section}`;
}

/**
 * Build a URL for language switching that preserves current context.
 *
 * @param newLang - Target language to switch to
 * @param currentState - Current navigation state
 * @returns URL path in the new language with same village/section
 */
export function buildLanguageSwitchUrl(
  newLang: SupportedLanguage,
  currentState: NavigationState
): string {
  // If on a village page, preserve village and section
  if (currentState.activeVillage) {
    return buildVillageUrl(
      newLang,
      currentState.activeVillage,
      currentState.activeSection || undefined
    );
  }

  // If on a hub page, preserve section
  if (currentState.isHubPage && currentState.activeSection) {
    return buildHubUrl(newLang, currentState.activeSection);
  }

  // Otherwise, go to homepage for that language
  return `/${newLang}`;
}

/**
 * Get the current language from the browser URL (client-side only).
 * Falls back to 'en' if unable to determine.
 *
 * @returns Current language code
 */
export function getCurrentLangFromBrowser(): SupportedLanguage {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const path = window.location.pathname;
  const match = path.match(/^\/(en|de|fr|it)\b/);

  return match ? (match[1] as SupportedLanguage) : 'en';
}

/**
 * Check if navigation is currently at a village level (not hub).
 *
 * @param state - Navigation state to check
 * @returns True if a specific village is active
 */
export function isVillageContext(state: NavigationState): boolean {
  return state.activeVillage !== null && !state.isHubPage;
}

/**
 * Check if navigation is on the homepage.
 *
 * @param state - Navigation state to check
 * @returns True if on homepage (no village, no section)
 */
export function isHomepage(state: NavigationState): boolean {
  return state.activeVillage === null && state.activeSection === null;
}
