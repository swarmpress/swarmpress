/**
 * Collection Getters
 * Simplified data retrieval using ONE Claude API call per collection
 */

// Types
export type {
  CollectionGetterOptions,
  CollectionGetterResult,
  WebsiteCollectionInfo,
  ResearchConfigInfo
} from './types'

// Core
export { getCollectionItems, getCollectionByType } from './base-getter'
export { transformToStructuredOutputSchema, wrapSchemaForArrayOutput, validateStructuredOutputSchema } from './schema-transformer'
export { buildCollectionPrompt } from './prompt-builder'

// Collection-specific getters
export {
  getRestaurants,
  getAccommodations,
  getHikes,
  getVillages,
  getPOIs,
  getEvents,
  getTransportation,
  getRegionInfo,
  getWeather,
  type RestaurantFilters,
  type AccommodationFilters,
  type HikeFilters,
  type POIFilters,
  type EventFilters,
  type WeatherFilters
} from './collections'
