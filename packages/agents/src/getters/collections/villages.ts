/**
 * Villages Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildVillagePromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export async function getVillages(
  websiteId: string,
  agentPersona: string,
  count = 5
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_villages',
    agentPersona,
    count,
    promptAdditions: buildVillagePromptAdditions()
  })
}
