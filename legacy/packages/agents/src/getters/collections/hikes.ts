/**
 * Hikes Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildHikePromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface HikeFilters {
  difficulty?: 'easy' | 'moderate' | 'difficult'
  startVillage?: string
  endVillage?: string
}

export async function getHikes(
  websiteId: string,
  agentPersona: string,
  filters?: HikeFilters,
  count = 15
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_hikes',
    agentPersona,
    count,
    filters,
    promptAdditions: buildHikePromptAdditions(filters)
  })
}
