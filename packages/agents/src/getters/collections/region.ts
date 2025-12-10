/**
 * Region Info Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildRegionPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export async function getRegionInfo(
  websiteId: string,
  agentPersona: string,
  count = 1
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_region',
    agentPersona,
    count,
    promptAdditions: buildRegionPromptAdditions()
  })
}
