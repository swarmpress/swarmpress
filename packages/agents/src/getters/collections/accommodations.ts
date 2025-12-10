/**
 * Accommodations Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildAccommodationPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface AccommodationFilters {
  village?: string
  type?: 'hotel' | 'b&b' | 'apartment' | 'vacation_rental'
  priceRange?: 'budget' | 'moderate' | 'luxury'
}

export async function getAccommodations(
  websiteId: string,
  agentPersona: string,
  filters?: AccommodationFilters,
  count = 20
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_accommodations',
    agentPersona,
    count,
    filters,
    promptAdditions: buildAccommodationPromptAdditions(filters)
  })
}
