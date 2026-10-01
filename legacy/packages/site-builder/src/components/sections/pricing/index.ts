/**
 * Pricing Section Components Registry
 * Maps variant names to pricing section components
 */

// Export all pricing components
export { default as PricingThreeTiers } from './PricingThreeTiers.astro'
export { default as PricingThreeTiersWithToggle } from './PricingThreeTiersWithToggle.astro'
export { default as PricingThreeTiersWithDividers } from './PricingThreeTiersWithDividers.astro'
export { default as PricingThreeTiersEmphasized } from './PricingThreeTiersEmphasized.astro'
export { default as PricingThreeTiersWithComparison } from './PricingThreeTiersWithComparison.astro'
export { default as PricingTwoTiers } from './PricingTwoTiers.astro'
export { default as PricingTwoTiersWithExtra } from './PricingTwoTiersWithExtra.astro'
export { default as PricingSinglePrice } from './PricingSinglePrice.astro'
export { default as PricingFourTiersWithToggle } from './PricingFourTiersWithToggle.astro'
export { default as PricingWithComparisonTable } from './PricingWithComparisonTable.astro'

// Variant mapping for ContentRenderer
export const PRICING_SECTION_VARIANTS: Record<string, string> = {
  'three-tiers': 'PricingThreeTiers',
  'three-tiers-with-toggle': 'PricingThreeTiersWithToggle',
  'three-tiers-with-dividers': 'PricingThreeTiersWithDividers',
  'three-tiers-emphasized': 'PricingThreeTiersEmphasized',
  'three-tiers-with-comparison': 'PricingThreeTiersWithComparison',
  'two-tiers': 'PricingTwoTiers',
  'two-tiers-with-extra': 'PricingTwoTiersWithExtra',
  'single-price': 'PricingSinglePrice',
  'four-tiers-with-toggle': 'PricingFourTiersWithToggle',
  'with-comparison-table': 'PricingWithComparisonTable',
}

// Default variant
export const DEFAULT_PRICING_VARIANT = 'three-tiers'
