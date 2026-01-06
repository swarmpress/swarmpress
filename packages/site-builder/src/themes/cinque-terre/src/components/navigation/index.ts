/**
 * Navigation Components Barrel Export
 *
 * All navigation-related components for the Coastal Spine navigation system.
 */

export { CoastalSpine } from './CoastalSpine';
export { VillageNode } from './VillageNode';
export { SectionNav } from './SectionNav';
export { LanguageSwitcher } from './LanguageSwitcher';
export { MobileNav } from './MobileNav';

// Hooks
export {
  useNavigationState,
  parseNavigationState,
  buildVillageUrl,
  buildHubUrl,
  buildLanguageSwitchUrl,
} from './useNavigationState';

// Re-export types
export type {
  NavigationState,
  CoastalSpineProps,
  VillageNodeProps,
  SectionNavProps,
  LanguageSwitcherProps,
  MobileNavProps,
} from '../../types/navigation.types';
