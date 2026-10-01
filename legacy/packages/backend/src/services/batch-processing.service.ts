/**
 * Batch Processing Service
 * Uses Claude Message Batches API for 50% cost savings on content generation
 *
 * Structure: 1 batch request = 1 village = 20 items
 *
 * Multi-Agent Pipeline per batch item:
 * 1. Research Agent: Generate top 20 items for a village using web_search
 * 2. Writer Agent: Optimize content with editorial persona
 * 3. Translator Agent: Translate to EN/DE/IT/FR
 * 4. SEO Agent: Generate SEO metadata, keywords, internal links
 *
 * Each batch item returns a single large JSON with all 20 items fully processed.
 */

import Anthropic from '@anthropic-ai/sdk'

// =============================================================================
// TYPES
// =============================================================================

export interface BatchRequest {
  custom_id: string // Format: "collectionType_village" (alphanumeric, underscore, hyphen only)
  params: {
    model: string
    max_tokens: number
    tools?: Array<{
      type: string
      name: string
    }>
    system?: string
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
    }>
  }
}

export interface BatchJob {
  id: string
  batch_id: string
  job_type: string
  collection_type?: string
  status: 'pending' | 'processing' | 'ended' | 'completed' | 'failed'
  items_count: number
  items_processed: number
  results_url?: string
  error_message?: string
  created_at: Date
  completed_at?: Date
}

export interface BatchResult {
  custom_id: string
  result: {
    type: 'succeeded' | 'errored' | 'expired' | 'canceled'
    message?: {
      content: Array<{
        type: 'text'
        text: string
      }>
    }
    error?: {
      type: string
      message: string
    }
  }
}

export interface CollectionSchema {
  type: string
  properties: Record<string, unknown>
  required?: string[]
}

export interface PipelineConfig {
  village: string
  collectionType: string
  schema: CollectionSchema
  itemCount?: number // default: 20
  languages?: string[] // default: ['en', 'de', 'it', 'fr']
  persona?: string // Writer persona
}

// =============================================================================
// COLLECTION SCHEMAS
// =============================================================================

const COLLECTION_SCHEMAS: Record<string, object> = {
  events: {
    type: 'object',
    required: ['slug', 'name', 'village', 'category', 'schedule'],
    properties: {
      slug: { type: 'string', description: 'URL-friendly identifier' },
      name: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      name_local: { type: 'string', description: 'Original Italian name' },
      village: { type: 'string', enum: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'] },
      category: { type: 'string', enum: ['festival', 'religious', 'cultural', 'food_wine', 'music', 'market', 'sport', 'other'] },
      schedule: {
        type: 'object',
        properties: {
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          recurring: { type: 'boolean' },
          recurrence_pattern: { type: 'string' },
          times: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } } } },
        },
      },
      location: { type: 'object', properties: { name: { type: 'object' }, address: { type: 'string' }, coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, venue_type: { type: 'string' } } },
      details: { type: 'object', properties: { description: { type: 'object' }, teaser: { type: 'object' }, highlights: { type: 'object' }, history: { type: 'object' }, atmosphere: { type: 'object' } } },
      tickets_pricing: { type: 'object', properties: { is_free: { type: 'boolean' }, price_range: { type: 'object' }, booking_required: { type: 'boolean' }, booking_url: { type: 'string' } } },
      practical_info: { type: 'object', properties: { dress_code: { type: 'object' }, accessibility: { type: 'object' }, parking: { type: 'object' }, public_transport: { type: 'object' } } },
      program: { type: 'array', items: { type: 'object', properties: { time: { type: 'string' }, activity: { type: 'object' }, location: { type: 'string' } } } },
      food_and_drink: { type: 'object', properties: { specialties: { type: 'object' }, vendors: { type: 'array' }, local_wines: { type: 'array' } } },
      tips_recommendations: { type: 'object', properties: { best_time_to_visit: { type: 'object' }, insider_tips: { type: 'object' }, what_to_bring: { type: 'object' }, photo_spots: { type: 'object' } } },
      weather_contingency: { type: 'object', properties: { rain_plan: { type: 'object' }, indoor_alternatives: { type: 'object' } } },
      contact_info: { type: 'object', properties: { organizer: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, website: { type: 'string' }, social_media: { type: 'object' } } },
      attendance: { type: 'object', properties: { expected_visitors: { type: 'string' }, crowd_level: { type: 'string' } } },
      ratings_reviews: { type: 'object', properties: { average_rating: { type: 'number' }, review_count: { type: 'number' }, highlights: { type: 'array' } } },
      seo_title: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_description: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_keywords: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      data_source: { type: 'string' },
      last_updated: { type: 'string', format: 'date-time' },
      published: { type: 'boolean' },
      featured: { type: 'boolean' },
      rank: { type: 'integer' },
    },
  },
  accommodations: {
    type: 'object',
    required: ['slug', 'name', 'village', 'type', 'price_range'],
    properties: {
      slug: { type: 'string' },
      name: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      village: { type: 'string', enum: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'] },
      type: { type: 'string', enum: ['hotel', 'b&b', 'apartment', 'hostel', 'agriturismo', 'villa', 'room'] },
      stars: { type: 'integer', minimum: 1, maximum: 5 },
      price_range: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' }, currency: { type: 'string' }, season: { type: 'string' } } },
      location: { type: 'object', properties: { address: { type: 'string' }, coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, distance_to_center: { type: 'string' }, distance_to_station: { type: 'string' }, sea_view: { type: 'boolean' } } },
      details: { type: 'object', properties: { description: { type: 'object' }, teaser: { type: 'object' }, highlights: { type: 'object' }, rooms: { type: 'integer' }, check_in: { type: 'string' }, check_out: { type: 'string' } } },
      amenities: { type: 'array', items: { type: 'string' } },
      contact: { type: 'object', properties: { phone: { type: 'string' }, email: { type: 'string' }, website: { type: 'string' } } },
      booking: { type: 'object', properties: { booking_url: { type: 'string' }, cancellation_policy: { type: 'object' } } },
      ratings: { type: 'object', properties: { average: { type: 'number' }, count: { type: 'integer' }, breakdown: { type: 'object' } } },
      tips: { type: 'object', properties: { insider_tips: { type: 'object' }, best_rooms: { type: 'object' }, when_to_book: { type: 'object' } } },
      seo_title: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_description: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_keywords: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      last_updated: { type: 'string', format: 'date-time' },
      published: { type: 'boolean' },
      featured: { type: 'boolean' },
      rank: { type: 'integer' },
    },
  },
  restaurants: {
    type: 'object',
    required: ['slug', 'name', 'village', 'cuisine_type', 'price_level'],
    properties: {
      slug: { type: 'string' },
      name: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      name_local: { type: 'string' },
      village: { type: 'string', enum: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'] },
      cuisine_type: { type: 'array', items: { type: 'string' } },
      price_level: { type: 'string', enum: ['$', '$$', '$$$', '$$$$'] },
      location: { type: 'object', properties: { address: { type: 'string' }, coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, setting: { type: 'string' }, sea_view: { type: 'boolean' } } },
      details: { type: 'object', properties: { description: { type: 'object' }, teaser: { type: 'object' }, specialties: { type: 'object' }, atmosphere: { type: 'object' } } },
      hours: { type: 'object', properties: { lunch: { type: 'string' }, dinner: { type: 'string' }, closed_days: { type: 'array' }, seasonal_hours: { type: 'string' } } },
      menu: { type: 'object', properties: { signature_dishes: { type: 'array' }, wine_list: { type: 'object' }, dietary_options: { type: 'array' } } },
      reservations: { type: 'object', properties: { required: { type: 'boolean' }, how_to_book: { type: 'object' }, booking_url: { type: 'string' } } },
      contact: { type: 'object', properties: { phone: { type: 'string' }, email: { type: 'string' }, website: { type: 'string' } } },
      ratings: { type: 'object', properties: { average: { type: 'number' }, count: { type: 'integer' }, highlights: { type: 'array' } } },
      tips: { type: 'object', properties: { insider_tips: { type: 'object' }, best_tables: { type: 'object' }, what_to_order: { type: 'object' } } },
      seo_title: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_description: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_keywords: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      last_updated: { type: 'string', format: 'date-time' },
      published: { type: 'boolean' },
      featured: { type: 'boolean' },
      rank: { type: 'integer' },
    },
  },
  pois: {
    type: 'object',
    required: ['slug', 'name', 'village', 'category'],
    properties: {
      slug: { type: 'string' },
      name: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      name_local: { type: 'string' },
      village: { type: 'string', enum: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'] },
      category: { type: 'string', enum: ['landmark', 'church', 'viewpoint', 'beach', 'harbor', 'museum', 'park', 'historic', 'nature', 'other'] },
      location: { type: 'object', properties: { address: { type: 'string' }, coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, how_to_reach: { type: 'object' } } },
      details: { type: 'object', properties: { description: { type: 'object' }, teaser: { type: 'object' }, history: { type: 'object' }, highlights: { type: 'object' }, architecture: { type: 'object' } } },
      visiting: { type: 'object', properties: { hours: { type: 'string' }, admission: { type: 'object' }, duration: { type: 'string' }, best_time: { type: 'object' } } },
      accessibility: { type: 'object', properties: { wheelchair: { type: 'boolean' }, difficulty: { type: 'string' }, stairs: { type: 'integer' } } },
      tips: { type: 'object', properties: { insider_tips: { type: 'object' }, photo_spots: { type: 'object' }, nearby: { type: 'array' } } },
      seo_title: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_description: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_keywords: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      last_updated: { type: 'string', format: 'date-time' },
      published: { type: 'boolean' },
      featured: { type: 'boolean' },
      rank: { type: 'integer' },
    },
  },
  hikes: {
    type: 'object',
    required: ['slug', 'name', 'start_village', 'difficulty'],
    properties: {
      slug: { type: 'string' },
      name: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      name_local: { type: 'string' },
      start_village: { type: 'string', enum: ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'] },
      end_village: { type: 'string' },
      difficulty: { type: 'string', enum: ['easy', 'moderate', 'challenging', 'expert'] },
      trail_number: { type: 'string' },
      stats: { type: 'object', properties: { distance_km: { type: 'number' }, duration_hours: { type: 'number' }, elevation_gain_m: { type: 'integer' }, elevation_loss_m: { type: 'integer' }, highest_point_m: { type: 'integer' } } },
      details: { type: 'object', properties: { description: { type: 'object' }, teaser: { type: 'object' }, highlights: { type: 'object' }, terrain: { type: 'object' }, scenery: { type: 'object' } } },
      practical: { type: 'object', properties: { best_season: { type: 'array' }, best_time_of_day: { type: 'object' }, trail_status: { type: 'string' }, fee_required: { type: 'boolean' }, cinque_terre_card: { type: 'boolean' } } },
      waypoints: { type: 'array', items: { type: 'object', properties: { name: { type: 'object' }, coordinates: { type: 'object' }, description: { type: 'object' }, facilities: { type: 'array' } } } },
      equipment: { type: 'object', properties: { required: { type: 'object' }, recommended: { type: 'object' } } },
      safety: { type: 'object', properties: { warnings: { type: 'object' }, emergency_contacts: { type: 'array' }, water_points: { type: 'array' } } },
      tips: { type: 'object', properties: { insider_tips: { type: 'object' }, photo_spots: { type: 'object' }, rest_stops: { type: 'object' } } },
      seo_title: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_description: { type: 'object', properties: { en: { type: 'string' }, de: { type: 'string' }, it: { type: 'string' }, fr: { type: 'string' } } },
      seo_keywords: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      last_updated: { type: 'string', format: 'date-time' },
      published: { type: 'boolean' },
      featured: { type: 'boolean' },
      rank: { type: 'integer' },
    },
  },
}

// =============================================================================
// AGENT PROMPTS
// =============================================================================

/**
 * Comprehensive prompt for generating ALL items for a village in one request
 * 1 request = 1 village = 20 items (fully processed)
 *
 * Pipeline: Research → Write → Translate → SEO
 */
function getComprehensivePipelinePrompt(config: PipelineConfig): {
  system: string
  user: string
  prefill: string
} {
  const baseType = config.collectionType.replace('cinqueterre_', '')
  const itemCount = config.itemCount || 20
  const languages = config.languages || ['en', 'de', 'it', 'fr']

  // Get the schema for this collection type
  const schema = COLLECTION_SCHEMAS[baseType] || config.schema

  const system = `You are a JSON content generator for CinqueTerre.Travel. Your ONLY output is valid JSON.

CRITICAL: You must output ONLY a valid JSON object. No explanations, no markdown, no prose before or after.

## YOUR TASK
Generate exactly ${itemCount} ${baseType} items for ${config.village}, Cinque Terre, Italy.

## PROCESS (internal, do not output)
1. Use web_search to research real ${baseType} in ${config.village}
2. For each item: gather name, location, details, coordinates
3. Write descriptions in all 4 languages (EN, DE, IT, FR)
4. Add SEO metadata

## OUTPUT RULES
- Output ONLY the JSON object
- Start your response with { and end with }
- No text before or after the JSON
- No markdown code blocks
- No explanations
- Exactly ${itemCount} items in the "items" array
- All text fields must have translations: {"en": "...", "de": "...", "it": "...", "fr": "..."}

## ITEM SCHEMA
${JSON.stringify(schema, null, 2)}

## RESPONSE FORMAT
Your entire response must be this exact JSON structure:
{
  "collection_type": "${config.collectionType}",
  "village": "${config.village}",
  "generated_at": "2025-12-10T00:00:00Z",
  "item_count": ${itemCount},
  "items": [
    { ... item 1 matching schema ... },
    { ... item 2 matching schema ... },
    ... exactly ${itemCount} items total
  ]
}`

  const user = `Generate ${itemCount} ${baseType} for ${config.village}.

Use web_search to find real places/events. Include:
- Real names, addresses, coordinates
- Descriptions in EN, DE, IT, FR
- Insider tips, highlights
- SEO titles and descriptions in all languages

Output the JSON now:`

  // Pre-fill to force JSON output
  const prefill = `{
  "collection_type": "${config.collectionType}",
  "village": "${config.village}",
  "generated_at": "${new Date().toISOString()}",
  "item_count": ${itemCount},
  "items": [`

  return { system, user, prefill }
}

// =============================================================================
// BATCH PROCESSING SERVICE
// =============================================================================

export class BatchProcessingService {
  private anthropic: Anthropic

  constructor(apiKey?: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    })
  }

  /**
   * Create a batch request for a collection pipeline
   *
   * Each batch request is a SINGLE API call (asynchronous).
   * We use a comprehensive prompt that instructs the model to:
   * 1. Research using web_search
   * 2. Write editorial content
   * 3. Translate to multiple languages
   * 4. Add SEO metadata
   *
   * All in one response, returning a single large JSON document.
   *
   * Uses assistant prefill to force JSON output format.
   */
  createPipelineBatchRequest(config: PipelineConfig): BatchRequest {
    const { system, user, prefill } = getComprehensivePipelinePrompt(config)

    return {
      custom_id: `${config.collectionType}-${config.village}`,
      params: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128000, // 128K tokens per collection for comprehensive content
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
          },
        ],
        system,
        messages: [
          {
            role: 'user',
            content: user,
          },
          {
            role: 'assistant',
            content: prefill, // Pre-fill forces JSON output format
          },
        ],
      },
    }
  }

  /**
   * Create batch requests for all villages in a collection
   */
  createCollectionBatch(
    collectionType: string,
    schema: CollectionSchema,
    villages: string[] = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'],
    options: Partial<PipelineConfig> = {}
  ): BatchRequest[] {
    return villages.map((village) =>
      this.createPipelineBatchRequest({
        village,
        collectionType,
        schema,
        ...options,
      })
    )
  }

  /**
   * Submit a batch to Anthropic
   * Uses beta.messages.batches API
   */
  async submitBatch(requests: BatchRequest[]): Promise<{
    batch_id: string
    status: string
    created_at: string
    request_counts: {
      total: number
      succeeded: number
      errored: number
      canceled: number
      expired: number
    }
  }> {
    // Create the batch using beta.messages.batches
    const batch = await this.anthropic.beta.messages.batches.create({
      requests: requests.map((req) => ({
        custom_id: req.custom_id,
        params: req.params,
      })),
    })

    return {
      batch_id: batch.id,
      status: batch.processing_status,
      created_at: batch.created_at,
      request_counts: batch.request_counts,
    }
  }

  /**
   * Check batch status
   */
  async getBatchStatus(batchId: string): Promise<{
    id: string
    status: string
    request_counts: {
      total: number
      succeeded: number
      errored: number
      canceled: number
      expired: number
    }
    results_url?: string
    ended_at?: string
  }> {
    const batch = await this.anthropic.beta.messages.batches.retrieve(batchId)

    return {
      id: batch.id,
      status: batch.processing_status,
      request_counts: batch.request_counts,
      results_url: batch.results_url,
      ended_at: batch.ended_at,
    }
  }

  /**
   * Poll until batch is complete
   */
  async waitForCompletion(
    batchId: string,
    options: {
      pollIntervalMs?: number
      maxWaitMs?: number
      onProgress?: (status: { succeeded: number; total: number }) => void
    } = {}
  ): Promise<string> {
    const { pollIntervalMs = 30_000, maxWaitMs = 24 * 60 * 60 * 1000, onProgress } = options

    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getBatchStatus(batchId)

      if (onProgress) {
        onProgress({
          succeeded: status.request_counts.succeeded,
          total: status.request_counts.total,
        })
      }

      if (status.status === 'ended') {
        if (!status.results_url) {
          throw new Error('Batch ended but no results URL provided')
        }
        return status.results_url
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Batch timed out after ${maxWaitMs / 1000 / 60} minutes`)
  }

  /**
   * Fetch and parse batch results
   */
  async fetchResults(resultsUrl: string): Promise<BatchResult[]> {
    // Need to add Authorization header for the results URL
    const response = await fetch(resultsUrl, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch results: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const results: BatchResult[] = []

    for (const line of text.split('\n').filter(Boolean)) {
      try {
        results.push(JSON.parse(line))
      } catch (e) {
        console.error('Failed to parse result line:', line.substring(0, 100))
      }
    }

    return results
  }

  /**
   * Reconstruct the prefill from custom_id
   * custom_id format: "cinqueterre_events-vernazza"
   */
  private reconstructPrefill(customId: string): string {
    // Parse custom_id: "cinqueterre_events-vernazza" → collectionType, village
    const lastHyphen = customId.lastIndexOf('-')
    const collectionType = customId.substring(0, lastHyphen)
    const village = customId.substring(lastHyphen + 1)

    return `{
  "collection_type": "${collectionType}",
  "village": "${village}",
  "generated_at": "2025-01-01T00:00:00.000Z",
  "item_count": 20,
  "items": [`
  }

  /**
   * Process a single result and extract the JSON content
   * Handles responses with tool_use blocks (from web_search)
   * Handles prefilled responses by prepending the prefill
   */
  extractContent(result: BatchResult): {
    customId: string
    success: boolean
    data?: Record<string, unknown>
    error?: string
  } {
    if (result.result.type !== 'succeeded') {
      return {
        customId: result.custom_id,
        success: false,
        error: result.result.error?.message || `Result type: ${result.result.type}`,
      }
    }

    if (!result.result.message?.content?.length) {
      return {
        customId: result.custom_id,
        success: false,
        error: 'No content in response',
      }
    }

    // Find all text blocks (there may be tool_use blocks before the final text output)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlocks = (result.result.message.content as any[]).filter(
      (block) => block.type === 'text'
    )

    if (textBlocks.length === 0) {
      return {
        customId: result.custom_id,
        success: false,
        error: 'No text content in response (only tool use blocks)',
      }
    }

    // Concatenate all text blocks
    let fullText = textBlocks.map((b) => b.text).join('').trim()

    // Check if the response appears to be a continuation (starts with array content or object)
    // If so, prepend the prefill to reconstruct the full JSON
    const isPrefillContinuation = !fullText.startsWith('{') || fullText.startsWith('{"')
    if (isPrefillContinuation && !fullText.includes('"collection_type"')) {
      const prefill = this.reconstructPrefill(result.custom_id)
      fullText = prefill + fullText
    }

    // Extract JSON from the text (may have prose before/after)
    let jsonText = ''

    // Try to find JSON object in the text
    // Look for opening brace and find matching closing brace
    const jsonStart = fullText.indexOf('{')
    if (jsonStart !== -1) {
      // Find the matching closing brace by counting braces
      let depth = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < fullText.length; i++) {
        if (fullText[i] === '{') depth++
        else if (fullText[i] === '}') {
          depth--
          if (depth === 0) {
            jsonEnd = i + 1
            break
          }
        }
      }
      if (jsonEnd !== -1) {
        jsonText = fullText.substring(jsonStart, jsonEnd)
      }
    }

    // If no JSON object found, try removing markdown blocks and looking again
    if (!jsonText) {
      // Remove markdown code blocks if present
      if (fullText.includes('```json')) {
        const match = fullText.match(/```json\n?([\s\S]*?)\n?```/)
        if (match) {
          jsonText = match[1]
        }
      } else if (fullText.includes('```')) {
        const match = fullText.match(/```\n?([\s\S]*?)\n?```/)
        if (match) {
          jsonText = match[1]
        }
      }
    }

    if (!jsonText) {
      return {
        customId: result.custom_id,
        success: false,
        error: 'No JSON content found in response',
      }
    }

    try {
      const data = JSON.parse(jsonText)

      return {
        customId: result.custom_id,
        success: true,
        data,
      }
    } catch (e) {
      return {
        customId: result.custom_id,
        success: false,
        error: `Failed to parse JSON: ${e}`,
      }
    }
  }

  /**
   * List all batches
   */
  async listBatches(limit: number = 20): Promise<
    Array<{
      id: string
      status: string
      created_at: string
      request_counts: {
        total: number
        succeeded: number
        errored: number
      }
    }>
  > {
    const batches = await this.anthropic.beta.messages.batches.list({ limit })
    const results: Array<{
      id: string
      status: string
      created_at: string
      request_counts: { total: number; succeeded: number; errored: number }
    }> = []

    for await (const b of batches) {
      results.push({
        id: b.id,
        status: b.processing_status,
        created_at: b.created_at,
        request_counts: b.request_counts,
      })
      if (results.length >= limit) break
    }

    return results
  }

  /**
   * Cancel a batch
   */
  async cancelBatch(batchId: string): Promise<void> {
    await this.anthropic.beta.messages.batches.cancel(batchId)
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let batchServiceInstance: BatchProcessingService | null = null

export function getBatchProcessingService(): BatchProcessingService {
  if (!batchServiceInstance) {
    batchServiceInstance = new BatchProcessingService()
  }
  return batchServiceInstance
}

export default BatchProcessingService
