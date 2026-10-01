/**
 * Weather Info Getter
 */

import { getCollectionItems } from '../base-getter'
import { buildWeatherPromptAdditions } from '../prompt-builder'
import type { CollectionGetterResult } from '../types'

export interface WeatherFilters {
  month?: string
  season?: 'spring' | 'summer' | 'fall' | 'winter'
}

export async function getWeather(
  websiteId: string,
  agentPersona: string,
  filters?: WeatherFilters,
  count = 12
): Promise<CollectionGetterResult> {
  return getCollectionItems({
    websiteId,
    collectionType: 'cinqueterre_weather',
    agentPersona,
    count,
    filters,
    promptAdditions: buildWeatherPromptAdditions(filters)
  })
}
