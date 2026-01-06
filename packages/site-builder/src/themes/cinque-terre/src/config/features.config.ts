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
  // When false: uses the current category-based dropdown navigation
  // When true: uses the new geographic coastal spine navigation
  useCoastalSpineNav:
    typeof import.meta !== 'undefined' &&
    import.meta.env?.PUBLIC_USE_COASTAL_SPINE === 'true',

  // Enable the new /{lang}/{village}/{section} URL structure
  // When false: only existing routes work
  // When true: new village-scoped routes are active
  useVillageScopedUrls:
    typeof import.meta !== 'undefined' &&
    import.meta.env?.PUBLIC_USE_VILLAGE_URLS === 'true',

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
    (FEATURES as Record<string, boolean>)[feature] = value;
  }
}
