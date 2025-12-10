/**
 * Events Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildEventPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface EventFilters {
  village?: string
  month?: string
  type?: 'festival' | 'religious' | 'cultural' | 'food'
}

export async function getEvents(
  websiteId: string,
  agentPersona: string,
  filters?: EventFilters,
  count = 15
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_events',
    agentPersona,
    count,
    filters,
    promptAdditions: buildEventPromptAdditions(filters)
  })
}
