/**
 * Block Metadata Schema for Agentic Content Generation
 *
 * This module defines metadata for block types that guides agents in:
 * - Selecting appropriate images (media requirements)
 * - Adding internal links (linking rules)
 * - Understanding block purpose (intent)
 *
 * Agents use this metadata to ensure content is:
 * - Visually relevant (no "Caribbean image on Riomaggiore" problems)
 * - Well-linked (contextual internal links from sitemap-index)
 * - Purposeful (each block serves a defined narrative function)
 */

import { z } from 'zod'

// ============================================================================
// Block Intent Types
// ============================================================================

/**
 * Intent describes the narrative purpose of a block
 */
export const BlockIntentSchema = z.enum([
  'showcase',    // Display visual content prominently (hero, gallery)
  'inform',      // Provide information/facts (paragraph, list, faq)
  'navigate',    // Guide user to other content (links, navigation)
  'convert',     // Drive action (CTA, booking, newsletter)
  'compare',     // Show options side-by-side (pricing, features)
  'orient',      // Set context/scene (intro, editorial hero)
  'engage',      // Encourage interaction (testimonial, quote)
])

export type BlockIntent = z.infer<typeof BlockIntentSchema>

// ============================================================================
// Media Requirements
// ============================================================================

/**
 * Entity matching strictness for media selection
 */
export const EntityMatchSchema = z.enum([
  'strict',    // Image village tag MUST match component entity
  'category',  // Image category MUST match, village can be 'region'
  'none',      // No entity matching required (generic content)
])

export type EntityMatch = z.infer<typeof EntityMatchSchema>

/**
 * Media requirements for a block type
 */
export const MediaRequirementsSchema = z.object({
  required: z.boolean().describe('Whether an image/media is required'),
  count: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }).describe('Min/max number of images'),
  entityMatch: EntityMatchSchema.describe('How strictly image must match entity'),
  allowedCategories: z.array(z.string()).optional().describe('Allowed image categories'),
  aspectRatio: z.enum(['square', 'video', 'portrait', 'landscape', 'any']).optional(),
})

export type MediaRequirements = z.infer<typeof MediaRequirementsSchema>

// ============================================================================
// Linking Rules
// ============================================================================

/**
 * Linking rules for a block type
 */
export const LinkingRulesSchema = z.object({
  minInternalLinks: z.number().int().nonnegative().describe('Minimum internal links required'),
  maxInternalLinks: z.number().int().positive().describe('Maximum internal links allowed'),
  allowedTargets: z.array(z.string()).describe('Page types/categories this block can link to'),
  anchorTextGuidance: z.string().optional().describe('How to write anchor text'),
})

export type BlockLinkingRules = z.infer<typeof LinkingRulesSchema>

// ============================================================================
// Block Metadata
// ============================================================================

/**
 * Complete metadata for a block type
 */
export const BlockMetadataSchema = z.object({
  type: z.string().describe('Block type identifier'),
  intent: BlockIntentSchema.describe('Narrative purpose of the block'),
  description: z.string().describe('Human-readable description of block purpose'),
  mediaRequirements: MediaRequirementsSchema.optional(),
  linkingRules: LinkingRulesSchema.optional(),
  contextRequirements: z.array(z.string()).optional().describe('Required context data (village, weather, etc.)'),
})

export type BlockMetadata = z.infer<typeof BlockMetadataSchema>

// ============================================================================
// Block Metadata Registry
// ============================================================================

/**
 * Metadata registry for all block types
 * Agents query this to understand block requirements
 */
export const BLOCK_METADATA: Record<string, BlockMetadata> = {
  // Core Blocks
  'paragraph': {
    type: 'paragraph',
    intent: 'inform',
    description: 'Text paragraph for conveying information',
    linkingRules: {
      minInternalLinks: 0,
      maxInternalLinks: 3,
      allowedTargets: ['villages', 'hikes', 'restaurants', 'accommodations', 'sights'],
      anchorTextGuidance: 'Use descriptive anchor text that describes the destination',
    },
  },

  'hero': {
    type: 'hero',
    intent: 'orient',
    description: 'Large hero section to set context and capture attention',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 1 },
      entityMatch: 'strict',
      allowedCategories: ['sights', 'beaches', 'trails'],
      aspectRatio: 'landscape',
    },
    linkingRules: {
      minInternalLinks: 0,
      maxInternalLinks: 2,
      allowedTargets: ['villages', 'itinerary'],
    },
  },

  'image': {
    type: 'image',
    intent: 'showcase',
    description: 'Single image with optional caption',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 1 },
      entityMatch: 'strict',
    },
  },

  'gallery': {
    type: 'gallery',
    intent: 'showcase',
    description: 'Multiple images in grid, carousel, or masonry layout',
    mediaRequirements: {
      required: true,
      count: { min: 3, max: 12 },
      entityMatch: 'strict',
      allowedCategories: ['sights', 'beaches', 'food', 'accommodations'],
    },
  },

  'faq': {
    type: 'faq',
    intent: 'inform',
    description: 'Frequently asked questions with expandable answers',
    linkingRules: {
      minInternalLinks: 1,
      maxInternalLinks: 5,
      allowedTargets: ['villages', 'hikes', 'transport', 'weather'],
      anchorTextGuidance: 'Link relevant terms in answers to related pages',
    },
  },

  // Cinque Terre Theme Blocks
  'editorial-hero': {
    type: 'editorial-hero',
    intent: 'orient',
    description: 'Editorial page hero with background image and article metadata',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 1 },
      entityMatch: 'strict',
      allowedCategories: ['sights', 'trails', 'food'],
      aspectRatio: 'landscape',
    },
    contextRequirements: ['village', 'category', 'author'],
  },

  'village-intro': {
    type: 'village-intro',
    intent: 'orient',
    description: 'Village introduction with lead story and essentials',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 2 },
      entityMatch: 'strict',
    },
    linkingRules: {
      minInternalLinks: 2,
      maxInternalLinks: 5,
      allowedTargets: ['restaurants', 'accommodations', 'hikes', 'beaches', 'sights'],
      anchorTextGuidance: 'Link to village subsections naturally in the narrative',
    },
    contextRequirements: ['village', 'weather', 'essentials'],
  },

  'places-to-stay': {
    type: 'places-to-stay',
    intent: 'showcase',
    description: 'Accommodation listings for a village',
    mediaRequirements: {
      required: true,
      count: { min: 3, max: 10 },
      entityMatch: 'strict',
      allowedCategories: ['accommodations'],
    },
    linkingRules: {
      minInternalLinks: 1,
      maxInternalLinks: 3,
      allowedTargets: ['accommodations', 'villages'],
    },
    contextRequirements: ['village'],
  },

  'eat-drink': {
    type: 'eat-drink',
    intent: 'showcase',
    description: 'Restaurant and food listings',
    mediaRequirements: {
      required: true,
      count: { min: 3, max: 10 },
      entityMatch: 'strict',
      allowedCategories: ['food', 'restaurants'],
    },
    linkingRules: {
      minInternalLinks: 1,
      maxInternalLinks: 3,
      allowedTargets: ['restaurants', 'villages', 'culinary'],
    },
    contextRequirements: ['village'],
  },

  'featured-carousel': {
    type: 'featured-carousel',
    intent: 'showcase',
    description: 'Carousel of featured content (stories, places)',
    mediaRequirements: {
      required: true,
      count: { min: 3, max: 8 },
      entityMatch: 'category',
      allowedCategories: ['sights', 'food', 'accommodations'],
    },
    linkingRules: {
      minInternalLinks: 3,
      maxInternalLinks: 8,
      allowedTargets: ['villages', 'blog', 'itinerary'],
    },
  },

  'village-selector': {
    type: 'village-selector',
    intent: 'navigate',
    description: 'Navigation component to select villages',
    mediaRequirements: {
      required: true,
      count: { min: 5, max: 5 },
      entityMatch: 'strict',
      allowedCategories: ['sights'],
    },
    linkingRules: {
      minInternalLinks: 5,
      maxInternalLinks: 5,
      allowedTargets: ['villages'],
    },
  },

  'highlights': {
    type: 'highlights',
    intent: 'showcase',
    description: 'Key highlights/features of an area',
    mediaRequirements: {
      required: true,
      count: { min: 3, max: 6 },
      entityMatch: 'category',
    },
    linkingRules: {
      minInternalLinks: 2,
      maxInternalLinks: 6,
      allowedTargets: ['villages', 'hikes', 'beaches', 'sights'],
    },
  },

  'itinerary-hero': {
    type: 'itinerary-hero',
    intent: 'orient',
    description: 'Hero section for itinerary pages',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 1 },
      entityMatch: 'category',
      aspectRatio: 'landscape',
    },
    contextRequirements: ['duration', 'difficulty'],
  },

  'itinerary-days': {
    type: 'itinerary-days',
    intent: 'inform',
    description: 'Day-by-day itinerary breakdown',
    mediaRequirements: {
      required: true,
      count: { min: 4, max: 10 },
      entityMatch: 'strict',
    },
    linkingRules: {
      minInternalLinks: 4,
      maxInternalLinks: 15,
      allowedTargets: ['villages', 'hikes', 'restaurants', 'accommodations'],
      anchorTextGuidance: 'Link each village and activity mentioned to its page',
    },
  },

  'collection-with-interludes': {
    type: 'collection-with-interludes',
    intent: 'showcase',
    description: 'Collection items with editorial interludes between groups',
    mediaRequirements: {
      required: true,
      count: { min: 5, max: 30 },
      entityMatch: 'strict',
    },
    linkingRules: {
      minInternalLinks: 2,
      maxInternalLinks: 10,
      allowedTargets: ['villages', 'restaurants', 'accommodations'],
    },
    contextRequirements: ['village', 'collection_type'],
  },

  // Marketing Blocks
  'hero-section': {
    type: 'hero-section',
    intent: 'orient',
    description: 'Full-width marketing hero with CTA buttons',
    mediaRequirements: {
      required: true,
      count: { min: 1, max: 1 },
      entityMatch: 'category',
      aspectRatio: 'landscape',
    },
    linkingRules: {
      minInternalLinks: 1,
      maxInternalLinks: 3,
      allowedTargets: ['villages', 'itinerary', 'accommodations'],
    },
  },

  'cta-section': {
    type: 'cta-section',
    intent: 'convert',
    description: 'Call-to-action section to drive user action',
    mediaRequirements: {
      required: false,
      count: { min: 0, max: 1 },
      entityMatch: 'none',
    },
    linkingRules: {
      minInternalLinks: 1,
      maxInternalLinks: 2,
      allowedTargets: ['itinerary', 'accommodations', 'restaurants'],
    },
  },

  'testimonial-section': {
    type: 'testimonial-section',
    intent: 'engage',
    description: 'Customer testimonials and reviews',
    mediaRequirements: {
      required: false,
      count: { min: 0, max: 5 },
      entityMatch: 'none',
    },
  },

  'newsletter': {
    type: 'newsletter',
    intent: 'convert',
    description: 'Newsletter signup form',
  },

  'about': {
    type: 'about',
    intent: 'inform',
    description: 'About section describing the publication/team',
    linkingRules: {
      minInternalLinks: 0,
      maxInternalLinks: 2,
      allowedTargets: ['team'],
    },
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get metadata for a block type
 */
export function getBlockMetadata(blockType: string): BlockMetadata | undefined {
  return BLOCK_METADATA[blockType]
}

/**
 * Check if a block type requires media
 */
export function requiresMedia(blockType: string): boolean {
  const metadata = BLOCK_METADATA[blockType]
  return metadata?.mediaRequirements?.required ?? false
}

/**
 * Get media requirements for a block type
 */
export function getMediaRequirements(blockType: string): MediaRequirements | undefined {
  return BLOCK_METADATA[blockType]?.mediaRequirements
}

/**
 * Get linking rules for a block type
 */
export function getLinkingRules(blockType: string): BlockLinkingRules | undefined {
  return BLOCK_METADATA[blockType]?.linkingRules
}

/**
 * Check if a block type can link to a page type
 */
export function canLinkTo(blockType: string, targetPageType: string): boolean {
  const rules = getLinkingRules(blockType)
  if (!rules) return true // No rules means any linking is allowed
  return rules.allowedTargets.includes(targetPageType)
}

/**
 * Validate media selection for a block
 */
export function validateMediaForBlock(
  blockType: string,
  imageVillage: string,
  componentVillage: string,
  imageCategory: string
): { valid: boolean; reason?: string } {
  const requirements = getMediaRequirements(blockType)

  if (!requirements) {
    return { valid: true }
  }

  // Check entity match
  switch (requirements.entityMatch) {
    case 'strict':
      if (imageVillage !== componentVillage && imageVillage !== 'region') {
        return {
          valid: false,
          reason: `Image village "${imageVillage}" does not match component village "${componentVillage}"`,
        }
      }
      break
    case 'category':
      // Just needs to match category, village can be anything
      break
    case 'none':
      // No entity matching required
      break
  }

  // Check category
  if (requirements.allowedCategories && requirements.allowedCategories.length > 0) {
    if (!requirements.allowedCategories.includes(imageCategory)) {
      return {
        valid: false,
        reason: `Image category "${imageCategory}" not in allowed categories: ${requirements.allowedCategories.join(', ')}`,
      }
    }
  }

  return { valid: true }
}
