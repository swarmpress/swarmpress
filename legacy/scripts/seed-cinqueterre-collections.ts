#!/usr/bin/env tsx
/**
 * Seed Script: Cinque Terre Collections
 * Converts Zod schemas to JSON Schema and stores them in the database
 * This script demonstrates the database-driven collection approach
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { v4 as uuidv4 } from 'uuid'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { db } from '../packages/backend/src/db/connection'

// Import all Cinque Terre collection schemas from local schemas directory
// These are website-specific and kept separate from the shared package
import {
  CinqueTerreRestaurantSchema,
  CreateCinqueTerreRestaurantSchema,
  CinqueTerreRestaurantFieldMetadata,
  CINQUETERRE_RESTAURANT_COLLECTION_TYPE,
} from './schemas/cinqueterre-restaurant'

import {
  CinqueTerreHikeSchema,
  CreateCinqueTerreHikeSchema,
  CinqueTerreHikeFieldMetadata,
  CINQUETERRE_HIKE_COLLECTION_TYPE,
} from './schemas/cinqueterre-hike'

import {
  CinqueTerreWeatherSchema,
  CINQUETERRE_WEATHER_COLLECTION_TYPE,
} from './schemas/cinqueterre-weather'

import {
  CinqueTerreEventSchema,
  CreateCinqueTerreEventSchema,
  CinqueTerreEventFieldMetadata,
  CINQUETERRE_EVENT_COLLECTION_TYPE,
} from './schemas/cinqueterre-event'

import {
  CinqueTerreTransportationSchema,
  CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE,
} from './schemas/cinqueterre-transportation'

import {
  CinqueTerreAccommodationSchema,
  CreateCinqueTerreAccommodationSchema,
  CinqueTerreAccommodationFieldMetadata,
  CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE,
} from './schemas/cinqueterre-accommodation'

import {
  CinqueTerrePoiSchema,
  CreateCinqueTerrePoiSchema,
  CinqueTerrePoiFieldMetadata,
  CINQUETERRE_POI_COLLECTION_TYPE,
} from './schemas/cinqueterre-poi'

import {
  CinqueTerreRegionSchema,
  CinqueTerreRegionFieldMetadata,
  CINQUETERRE_REGION_COLLECTION_TYPE,
} from './schemas/cinqueterre-region'

import {
  CinqueTerreVillageResponseSchema,
  CinqueTerreVillageCreateSchema,
  CinqueTerreVillageCollectionDefinition,
} from './schemas/cinqueterre-village'

import type { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

interface CollectionDefinition {
  type: string
  displayName: string
  singularName: string
  icon: string
  color: string
  description: string
  schema: z.ZodType<unknown>
  createSchema?: z.ZodType<unknown>
  fieldMetadata?: Record<string, unknown>
  titleField?: string
  summaryField?: string
  imageField?: string
  dateField?: string
}

// ============================================================================
// Collection Definitions
// ============================================================================

const CINQUETERRE_COLLECTIONS: CollectionDefinition[] = [
  {
    type: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.icon,
    color: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.color,
    description: CINQUETERRE_RESTAURANT_COLLECTION_TYPE.description,
    schema: CinqueTerreRestaurantSchema,
    createSchema: CreateCinqueTerreRestaurantSchema,
    fieldMetadata: CinqueTerreRestaurantFieldMetadata,
    titleField: 'name',
    summaryField: 'details.atmosphere',
  },
  {
    type: CINQUETERRE_HIKE_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_HIKE_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_HIKE_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_HIKE_COLLECTION_TYPE.icon,
    color: CINQUETERRE_HIKE_COLLECTION_TYPE.color,
    description: CINQUETERRE_HIKE_COLLECTION_TYPE.description,
    schema: CinqueTerreHikeSchema,
    createSchema: CreateCinqueTerreHikeSchema,
    fieldMetadata: CinqueTerreHikeFieldMetadata,
    titleField: 'name',
    summaryField: 'description',
  },
  {
    type: CINQUETERRE_WEATHER_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_WEATHER_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_WEATHER_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_WEATHER_COLLECTION_TYPE.icon,
    color: CINQUETERRE_WEATHER_COLLECTION_TYPE.color,
    description: CINQUETERRE_WEATHER_COLLECTION_TYPE.description,
    schema: CinqueTerreWeatherSchema,
    titleField: 'location',
    dateField: 'timestamp',
  },
  {
    type: CINQUETERRE_EVENT_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_EVENT_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_EVENT_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_EVENT_COLLECTION_TYPE.icon,
    color: CINQUETERRE_EVENT_COLLECTION_TYPE.color,
    description: CINQUETERRE_EVENT_COLLECTION_TYPE.description,
    schema: CinqueTerreEventSchema,
    createSchema: CreateCinqueTerreEventSchema,
    fieldMetadata: CinqueTerreEventFieldMetadata,
    titleField: 'name',
    summaryField: 'short_description',
    dateField: 'schedule.start_date',
  },
  {
    type: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.icon,
    color: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.color,
    description: CINQUETERRE_TRANSPORTATION_COLLECTION_TYPE.description,
    schema: CinqueTerreTransportationSchema,
    titleField: 'type',
  },
  {
    type: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.icon,
    color: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.color,
    description: CINQUETERRE_ACCOMMODATION_COLLECTION_TYPE.description,
    schema: CinqueTerreAccommodationSchema,
    createSchema: CreateCinqueTerreAccommodationSchema,
    fieldMetadata: CinqueTerreAccommodationFieldMetadata,
    titleField: 'name',
    summaryField: 'description',
    imageField: 'images',
  },
  {
    type: CINQUETERRE_POI_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_POI_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_POI_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_POI_COLLECTION_TYPE.icon,
    color: CINQUETERRE_POI_COLLECTION_TYPE.color,
    description: CINQUETERRE_POI_COLLECTION_TYPE.description,
    schema: CinqueTerrePoiSchema,
    createSchema: CreateCinqueTerrePoiSchema,
    fieldMetadata: CinqueTerrePoiFieldMetadata,
    titleField: 'name',
    summaryField: 'description',
  },
  {
    type: CINQUETERRE_REGION_COLLECTION_TYPE.type,
    displayName: CINQUETERRE_REGION_COLLECTION_TYPE.displayName,
    singularName: CINQUETERRE_REGION_COLLECTION_TYPE.singularName,
    icon: CINQUETERRE_REGION_COLLECTION_TYPE.icon,
    color: CINQUETERRE_REGION_COLLECTION_TYPE.color,
    description: CINQUETERRE_REGION_COLLECTION_TYPE.description,
    schema: CinqueTerreRegionSchema,
    fieldMetadata: CinqueTerreRegionFieldMetadata,
    titleField: 'basic_information.name',
    summaryField: 'basic_information.tagline',
  },
  {
    type: CinqueTerreVillageCollectionDefinition.type,
    displayName: CinqueTerreVillageCollectionDefinition.displayName,
    singularName: CinqueTerreVillageCollectionDefinition.singularName || 'Village',
    icon: CinqueTerreVillageCollectionDefinition.icon,
    color: CinqueTerreVillageCollectionDefinition.color,
    description: CinqueTerreVillageCollectionDefinition.description,
    schema: CinqueTerreVillageResponseSchema,
    createSchema: CinqueTerreVillageCreateSchema,
    titleField: 'basic_information.name',
    summaryField: 'basic_information.tagline',
  },
]

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert a Zod schema to JSON Schema format
 */
function convertToJsonSchema(schema: z.ZodType<unknown>, name?: string): Record<string, unknown> {
  return zodToJsonSchema(schema, {
    name,
    $refStrategy: 'none',
  }) as Record<string, unknown>
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Find or create the Cinque Terre website
 */
async function findOrCreateCinqueTerreWebsite(): Promise<string> {
  // Check if the website already exists
  const { rows: existingRows } = await db.query<{ id: string }>(
    `SELECT id FROM websites WHERE domain = $1`,
    ['cinqueterre.travel']
  )

  if (existingRows.length > 0) {
    console.log(`✅ Found existing Cinque Terre website: ${existingRows[0].id}`)
    return existingRows[0].id
  }

  // Create the website
  const websiteId = uuidv4()
  await db.query(
    `INSERT INTO websites (id, name, domain, description, config)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      websiteId,
      'Cinque Terre Travel Guide',
      'cinqueterre.travel',
      'Comprehensive travel guide to the five villages of Cinque Terre, Italy',
      JSON.stringify({
        theme: 'travel',
        locale: 'en-US',
        defaultLocale: 'en',
        locales: ['en', 'it', 'de', 'fr'],
        features: {
          collections: true,
          search: true,
          analytics: true,
        },
      }),
    ]
  )

  console.log(`✅ Created Cinque Terre website: ${websiteId}`)
  return websiteId
}

/**
 * Create a collection in the database
 */
async function createCollection(
  websiteId: string,
  definition: CollectionDefinition
): Promise<string> {
  const collectionId = uuidv4()

  // Convert Zod schema to JSON Schema
  const jsonSchema = convertToJsonSchema(definition.schema, definition.type)
  const createSchema = definition.createSchema
    ? convertToJsonSchema(definition.createSchema, `${definition.type}_create`)
    : null

  await db.query(
    `INSERT INTO website_collections (
      id,
      website_id,
      collection_type,
      json_schema,
      create_schema,
      display_name,
      singular_name,
      description,
      icon,
      color,
      field_metadata,
      title_field,
      summary_field,
      image_field,
      date_field,
      enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (website_id, collection_type) DO UPDATE SET
      json_schema = EXCLUDED.json_schema,
      create_schema = EXCLUDED.create_schema,
      display_name = EXCLUDED.display_name,
      singular_name = EXCLUDED.singular_name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      color = EXCLUDED.color,
      field_metadata = EXCLUDED.field_metadata,
      title_field = EXCLUDED.title_field,
      summary_field = EXCLUDED.summary_field,
      image_field = EXCLUDED.image_field,
      date_field = EXCLUDED.date_field,
      updated_at = NOW()
    RETURNING id`,
    [
      collectionId,
      websiteId,
      definition.type,
      JSON.stringify(jsonSchema),
      createSchema ? JSON.stringify(createSchema) : null,
      definition.displayName,
      definition.singularName,
      definition.description,
      definition.icon,
      definition.color,
      JSON.stringify(definition.fieldMetadata || {}),
      definition.titleField || 'name',
      definition.summaryField || null,
      definition.imageField || null,
      definition.dateField || null,
      true,
    ]
  )

  return collectionId
}

// ============================================================================
// ============================================================================
// Research Configurations
// ============================================================================

interface ResearchConfig {
  collectionType: string
  enabled: boolean
  searchPrompt?: string
  defaultQueries?: string[]
  extractionHints?: Record<string, string>
  requireSourceUrls?: boolean
  autoPublish?: boolean
}

const CINQUETERRE_RESEARCH_CONFIGS: ResearchConfig[] = [
  {
    collectionType: 'cinqueterre_restaurants',
    enabled: true,
    searchPrompt: 'Find authentic Italian restaurants, trattorie, ristoranti, and focaccerie in Cinque Terre, Italy. Focus on local, family-run establishments with traditional Ligurian cuisine.',
    defaultQueries: [
      'best restaurants Cinque Terre 2024',
      'where to eat Riomaggiore authentic',
      'Monterosso seafood restaurant reviews',
      'Vernazza trattoria recommendations',
      'local food Manarola Corniglia'
    ],
    extractionHints: {
      price_range: 'Estimate €, €€, €€€, or €€€€ based on reviews and menu prices',
      location: 'Include which of the 5 villages: Monterosso, Vernazza, Corniglia, Manarola, Riomaggiore',
      cuisine_type: 'Focus on Ligurian specialties like pesto, focaccia, anchovies, seafood'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_hikes',
    enabled: true,
    searchPrompt: 'Find hiking trails and walking paths in Cinque Terre National Park, Italy. Include the famous Sentiero Azzurro (Blue Trail) segments and alternative routes.',
    defaultQueries: [
      'Cinque Terre hiking trails 2024',
      'Sentiero Azzurro trail conditions',
      'best hikes between villages Cinque Terre',
      'difficulty level Cinque Terre trails'
    ],
    extractionHints: {
      difficulty: 'Rate as Easy, Moderate, Difficult, or Expert based on terrain and elevation',
      duration: 'Provide walking time in minutes or hours',
      trail_status: 'Note if trail is open, closed, or requires paid access (Cinque Terre Card)'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_pois',
    enabled: true,
    searchPrompt: 'Find points of interest, landmarks, and attractions in Cinque Terre, Italy. Include historic sites, beaches, viewpoints, churches, and cultural attractions.',
    defaultQueries: [
      'Cinque Terre attractions landmarks',
      'best viewpoints Cinque Terre',
      'beaches Monterosso Vernazza',
      'historic churches Cinque Terre'
    ],
    extractionHints: {
      category: 'Classify as: beach, viewpoint, church, historic site, museum, harbor, tower, or other',
      accessibility: 'Note accessibility for people with limited mobility'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_accommodations',
    enabled: true,
    searchPrompt: 'Find hotels, B&Bs, guesthouses, and vacation rentals in Cinque Terre, Italy. Include accommodations in all five villages.',
    defaultQueries: [
      'best hotels Cinque Terre 2024',
      'where to stay Monterosso',
      'budget accommodation Riomaggiore',
      'sea view rooms Vernazza'
    ],
    extractionHints: {
      type: 'Classify as: hotel, B&B, guesthouse, apartment, or hostel',
      price_range: 'Estimate nightly rate range in EUR',
      features: 'Note key features like sea view, air conditioning, parking'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_events',
    enabled: true,
    searchPrompt: 'Find festivals, events, and celebrations in Cinque Terre, Italy. Include religious festivals, food events, and cultural celebrations.',
    defaultQueries: [
      'Cinque Terre festivals 2024 2025',
      'local events Monterosso',
      'Festa del Limone Monterosso',
      'religious celebrations Cinque Terre'
    ],
    extractionHints: {
      event_type: 'Classify as: festival, religious, food/wine, cultural, or sporting event',
      dates: 'Include specific dates or typical month/season when event occurs'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_villages',
    enabled: true,
    searchPrompt: 'Find detailed information about the five villages of Cinque Terre: Monterosso al Mare, Vernazza, Corniglia, Manarola, and Riomaggiore.',
    defaultQueries: [
      'Monterosso al Mare guide',
      'Vernazza village information',
      'Corniglia what to see',
      'Manarola history attractions',
      'Riomaggiore things to do'
    ],
    extractionHints: {
      population: 'Include approximate population if available',
      characteristics: 'Note unique features like beach, castle, church, or famous viewpoints'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_transportation',
    enabled: true,
    searchPrompt: 'Find transportation information for Cinque Terre, Italy including trains, boats, and getting there from major cities.',
    defaultQueries: [
      'Cinque Terre train schedule 2024',
      'ferry between villages Cinque Terre',
      'how to get to Cinque Terre from Pisa',
      'Cinque Terre Card prices 2024'
    ],
    extractionHints: {
      transport_type: 'Classify as: train, ferry, bus, car, or walking',
      prices: 'Include current prices in EUR when available'
    },
    requireSourceUrls: true,
    autoPublish: false
  },
  {
    collectionType: 'cinqueterre_region',
    enabled: true,
    searchPrompt: 'Find general information about Cinque Terre region in Liguria, Italy. Include UNESCO World Heritage status, geography, climate, and practical visitor information.',
    defaultQueries: [
      'Cinque Terre UNESCO World Heritage',
      'best time to visit Cinque Terre',
      'Cinque Terre weather by month',
      'Cinque Terre visitor tips'
    ],
    extractionHints: {
      geography: 'Include information about coastline, terrain, and location in Liguria',
      climate: 'Note typical weather patterns and best visiting seasons'
    },
    requireSourceUrls: true,
    autoPublish: false
  }
]

/**
 * Seed research configurations for collections
 */
async function seedResearchConfigs(websiteId: string): Promise<void> {
  console.log('Creating research configurations...\n')

  for (const config of CINQUETERRE_RESEARCH_CONFIGS) {
    try {
      // Get collection ID
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM website_collections WHERE website_id = $1 AND collection_type = $2`,
        [websiteId, config.collectionType]
      )

      if (rows.length === 0) {
        console.log(`  ⚠️ Collection not found: ${config.collectionType}`)
        continue
      }

      const collectionId = rows[0].id

      // Upsert research config
      await db.query(
        `INSERT INTO collection_research_config (
          collection_id, enabled, search_prompt, default_queries,
          extraction_hints, require_source_urls, auto_publish
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (collection_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          search_prompt = EXCLUDED.search_prompt,
          default_queries = EXCLUDED.default_queries,
          extraction_hints = EXCLUDED.extraction_hints,
          require_source_urls = EXCLUDED.require_source_urls,
          auto_publish = EXCLUDED.auto_publish,
          updated_at = NOW()`,
        [
          collectionId,
          config.enabled,
          config.searchPrompt || null,
          JSON.stringify(config.defaultQueries || []),
          config.extractionHints ? JSON.stringify(config.extractionHints) : null,
          config.requireSourceUrls ?? true,
          config.autoPublish ?? false
        ]
      )

      console.log(`  ✅ ${config.collectionType}`)
    } catch (error) {
      console.error(`  ❌ Failed to create research config for ${config.collectionType}:`, error)
    }
  }
}

// ============================================================================
// Main Seed Function
// ============================================================================

async function seedCinqueTerreCollections() {
  console.log('🌱 Seeding Cinque Terre collection schemas...\n')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected\n')

    // Find or create the Cinque Terre website
    const websiteId = await findOrCreateCinqueTerreWebsite()
    console.log('')

    // Create each collection
    console.log('Creating collection schemas...\n')

    for (const definition of CINQUETERRE_COLLECTIONS) {
      try {
        await createCollection(websiteId, definition)
        console.log(`  ✅ ${definition.displayName} (${definition.type})`)
      } catch (error) {
        console.error(`  ❌ Failed to create ${definition.type}:`, error)
      }
    }

    console.log('')

    // Seed research configurations
    await seedResearchConfigs(websiteId)

    console.log('')
    console.log('✨ Seeding completed successfully!\n')
    console.log('Summary:')
    console.log(`  Website ID: ${websiteId}`)
    console.log(`  Collections created: ${CINQUETERRE_COLLECTIONS.length}`)
    console.log(`  Research configs: ${CINQUETERRE_RESEARCH_CONFIGS.length}`)
    console.log('')
    console.log('Collection types:')
    for (const def of CINQUETERRE_COLLECTIONS) {
      console.log(`  - ${def.type} (${def.singularName})`)
    }
    console.log('')

    // Verify the collections were created
    const { rows } = await db.query<{ collection_type: string; display_name: string }>(
      `SELECT collection_type, display_name FROM website_collections WHERE website_id = $1 ORDER BY display_name`,
      [websiteId]
    )

    console.log('Verified collections in database:')
    for (const row of rows) {
      console.log(`  ✓ ${row.display_name} (${row.collection_type})`)
    }
    console.log('')

    // Verify research configs
    const { rows: researchRows } = await db.query<{ collection_type: string; enabled: boolean }>(
      `SELECT wc.collection_type, crc.enabled
       FROM collection_research_config crc
       JOIN website_collections wc ON wc.id = crc.collection_id
       WHERE wc.website_id = $1
       ORDER BY wc.collection_type`,
      [websiteId]
    )

    console.log('Verified research configs in database:')
    for (const row of researchRows) {
      console.log(`  ✓ ${row.collection_type} (enabled: ${row.enabled})`)
    }
    console.log('')

    await db.end()
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    await db.end()
    process.exit(1)
  }
}

// Run seed
seedCinqueTerreCollections()
