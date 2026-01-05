/**
 * Cinque Terre Theme Component Registry
 * Maps JSON block types to Astro/React components
 */

import type { BlockType } from './types';

/**
 * Block type to component mapping
 * Used by ContentRenderer to dynamically render blocks
 */
export const blockRegistry: Record<BlockType, {
    component: string;
    isReact?: boolean;
    clientDirective?: 'load' | 'visible' | 'idle' | 'only';
}> = {
    'hero-section': {
        component: 'Hero',
        isReact: false,
    },
    'stats-section': {
        component: 'Stats',
        isReact: false,
    },
    'feature-section': {
        component: 'Features',
        isReact: false,
    },
    'village-selector': {
        component: 'VillageSelector',
        isReact: false,
    },
    'places-to-stay': {
        component: 'PlacesToStay',
        isReact: false,
    },
    'featured-carousel': {
        component: 'FeaturedCarousel',
        isReact: true,
        clientDirective: 'visible',
    },
    'village-intro': {
        component: 'VillageIntro',
        isReact: false,
    },
    'eat-drink': {
        component: 'EatDrink',
        isReact: true,
        clientDirective: 'visible',
    },
    'newsletter': {
        component: 'Newsletter',
        isReact: false,
    },
    'section-header': {
        component: 'SectionHeader',
        isReact: false,
    },
};

/**
 * Get component info for a block type
 */
export function getComponentForBlock(blockType: string) {
    return blockRegistry[blockType as BlockType] || null;
}

/**
 * Check if a block type is supported
 */
export function isBlockTypeSupported(blockType: string): blockType is BlockType {
    return blockType in blockRegistry;
}

/**
 * List all supported block types
 */
export function getSupportedBlockTypes(): BlockType[] {
    return Object.keys(blockRegistry) as BlockType[];
}
