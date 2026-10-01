/**
 * Points of Interest Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildPOIPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface POIFilters {
  village?: string
  category?: 'viewpoint' | 'beach' | 'church' | 'landmark' | 'harbor'
}

export async function getPOIs(
  websiteId: string,
  agentPersona: string,
  filters?: POIFilters,
  count = 20
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_pois',
    agentPersona,
    count,
    filters,
    promptAdditions: buildPOIPromptAdditions(filters)
  })
}
