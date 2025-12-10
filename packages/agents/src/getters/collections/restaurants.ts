/**
 * Restaurants Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildRestaurantPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface RestaurantFilters {
  village?: string
  cuisine?: string
  priceRange?: 'budget' | 'moderate' | 'upscale'
}

export async function getRestaurants(
  websiteId: string,
  agentPersona: string,
  filters?: RestaurantFilters,
  count = 20
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_restaurants',
    agentPersona,
    count,
    filters,
    promptAdditions: buildRestaurantPromptAdditions(filters)
  })
}
