/**
 * Feature Flags Configuration
 *
 * Controls gradual rollout of the Coastal Spine navigation system.
 * Set via environment variables for flexibility across environments.
 */

import type { FeatureFlags } from '../types/navigation.types';

/**
 * Read feature flags from environment variables with defaults.
 *
 * Environment variables (set in .env or deployment config):
 * - PUBLIC_USE_COASTAL_SPINE: Enable the new Coastal Spine navigation
 * - PUBLIC_USE_VILLAGE_URLS: Enable village-scoped URL routing
 * - PUBLIC_MOBILE_BOTTOM_NAV: Use bottom navigation on mobile
 */
export const FEATURES: FeatureFlags = {
  // Toggle between legacy Header and new CoastalSpine navigation
  // Default: TRUE (Coastal Spine enabled)
  // Set PUBLIC_USE_COASTAL_SPINE=false to use legacy navigation
  useCoastalSpineNav:
    typeof import.meta === 'undefined' ||
    import.meta.env?.PUBLIC_USE_COASTAL_SPINE !== 'false',

  // Enable the new /{lang}/{village}/{section} URL structure
  // Default: TRUE (village-scoped URLs enabled)
  // Set PUBLIC_USE_VILLAGE_URLS=false to disable
  useVillageScopedUrls:
    typeof import.meta === 'undefined' ||
    import.meta.env?.PUBLIC_USE_VILLAGE_URLS !== 'false',

  // Show the language switcher in the navigation
  // Generally always true, but can be disabled for testing
  showLanguageSwitcher: true,

  // Use fixed bottom navigation on mobile instead of hamburger menu
  // Experimental feature for future consideration
  enableMobileBottomNav:
    typeof import.meta !== 'undefined' &&
    import.meta.env?.PUBLIC_MOBILE_BOTTOM_NAV === 'true',
};

/**
 * Get a feature flag value with a fallback
 */
export function isFeatureEnabled(
  feature: keyof FeatureFlags,
  fallback: boolean = false
): boolean {
  return FEATURES[feature] ?? fallback;
}

/**
 * Override feature flags for testing or development
 * Only works in development mode
 */
export function setFeatureFlag(
  feature: keyof FeatureFlags,
  value: boolean
): void {
  if (import.meta.env?.DEV) {
    (FEATURES as unknown as Record<string, boolean>)[feature] = value;
  }
}
