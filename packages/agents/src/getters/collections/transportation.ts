/**
 * Transportation Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildTransportationPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export async function getTransportation(
  websiteId: string,
  agentPersona: string,
  count = 10
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_transportation',
    agentPersona,
    count,
    promptAdditions: buildTransportationPromptAdditions()
  })
}
