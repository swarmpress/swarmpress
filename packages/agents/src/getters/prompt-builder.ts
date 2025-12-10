/**
 * Prompt Builder
 * Builds collection-specific prompts combining schema, research config, and agent persona
 */

import type { CollectionGetterOptions, WebsiteCollectionInfo, ResearchConfigInfo } from './types'

/**
 * Build the main collection research prompt
 */
export function buildCollectionPrompt(
  collection: WebsiteCollectionInfo,
  researchConfig: ResearchConfigInfo | null,
  options: CollectionGetterOptions
): string {
  const count = options.count || 20
  const searchPrompt = researchConfig?.search_prompt || `Research ${collection.display_name}`
  const hints = researchConfig?.extraction_hints || {}

  let prompt = `You are a ${options.agentPersona}.

## Task
${searchPrompt}

## Target
Find ${count} items for the "${collection.display_name}" collection.
`

  // Add filters if present
  if (options.filters && Object.keys(options.filters).length > 0) {
    prompt += `
## Filters
${formatFilters(options.filters)}
`
  }

  // Add field guidelines if present
  if (Object.keys(hints).length > 0) {
    prompt += `
## Field Guidelines
${Object.entries(hints).map(([field, hint]) => `- **${field}**: ${hint}`).join('\n')}
`
  }

  // Add collection-specific prompt additions
  if (options.promptAdditions) {
    prompt += `
## Additional Instructions
${options.promptAdditions}
`
  }

  prompt += `
## Important Guidelines
- Use web search to find current, accurate information
- Only include items you're confident about
- Every item should have verifiable information
- Focus on quality over quantity
- Return exactly the fields required by the schema

## OUTPUT FORMAT (CRITICAL)
After completing your research, you MUST end your response with a valid JSON code block.
The JSON must follow this exact format:

\`\`\`json
{
  "items": [
    { ... item 1 matching the schema ... },
    { ... item 2 matching the schema ... }
  ]
}
\`\`\`

This JSON output is REQUIRED. Do not skip it.`

  return prompt.trim()
}

/**
 * Format filters for prompt display
 */
function formatFilters(filters: Record<string, unknown>): string {
  return Object.entries(filters)
    .map(([key, value]) => {
      if (value === undefined || value === null) return null
      return `- **${key}**: ${typeof value === 'object' ? JSON.stringify(value) : value}`
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Build restaurant-specific prompt additions
 */
export function buildRestaurantPromptAdditions(filters?: {
  village?: string
  cuisine?: string
  priceRange?: string
}): string {
  const additions: string[] = [
    'Focus on authentic local restaurants frequented by locals, not just tourist establishments.',
    'Include details about signature dishes, atmosphere, and what makes each place special.',
  ]

  if (filters?.village) {
    additions.push(`Specifically focus on restaurants in or near ${filters.village}.`)
  }
  if (filters?.cuisine) {
    additions.push(`Prefer restaurants serving ${filters.cuisine} cuisine.`)
  }
  if (filters?.priceRange) {
    additions.push(`Focus on ${filters.priceRange} price range establishments.`)
  }

  return additions.join('\n')
}

/**
 * Build accommodation-specific prompt additions
 */
export function buildAccommodationPromptAdditions(filters?: {
  village?: string
  type?: string
  priceRange?: string
}): string {
  const additions: string[] = [
    'Include a mix of hotels, B&Bs, and vacation rentals.',
    'Note any special features like sea views, historic buildings, or unique amenities.',
  ]

  if (filters?.village) {
    additions.push(`Focus on accommodations in or near ${filters.village}.`)
  }
  if (filters?.type) {
    additions.push(`Prefer ${filters.type} type accommodations.`)
  }
  if (filters?.priceRange) {
    additions.push(`Focus on ${filters.priceRange} price range options.`)
  }

  return additions.join('\n')
}

/**
 * Build hike-specific prompt additions
 */
export function buildHikePromptAdditions(filters?: {
  difficulty?: string
  startVillage?: string
  endVillage?: string
}): string {
  const additions: string[] = [
    'Include accurate trail information: distance, elevation gain, estimated duration.',
    'Note current trail conditions if available, and any seasonal closures.',
    'Include details about scenic viewpoints and what hikers can expect to see.',
  ]

  if (filters?.difficulty) {
    additions.push(`Focus on ${filters.difficulty} difficulty trails.`)
  }
  if (filters?.startVillage) {
    additions.push(`Include trails starting from ${filters.startVillage}.`)
  }
  if (filters?.endVillage) {
    additions.push(`Include trails ending at ${filters.endVillage}.`)
  }

  return additions.join('\n')
}

/**
 * Build village-specific prompt additions
 */
export function buildVillagePromptAdditions(): string {
  return [
    'Include all five main Cinque Terre villages: Monterosso, Vernazza, Corniglia, Manarola, Riomaggiore.',
    'Provide accurate historical information and notable landmarks.',
    'Include practical visitor information like train access, main attractions, and best viewpoints.',
    'Note what makes each village unique and different from the others.',
  ].join('\n')
}

/**
 * Build POI-specific prompt additions
 */
export function buildPOIPromptAdditions(filters?: {
  village?: string
  category?: string
}): string {
  const additions: string[] = [
    'Include a variety of points of interest: viewpoints, churches, beaches, landmarks.',
    'Provide accurate location information and visiting tips.',
  ]

  if (filters?.village) {
    additions.push(`Focus on points of interest in or near ${filters.village}.`)
  }
  if (filters?.category) {
    additions.push(`Focus on ${filters.category} type attractions.`)
  }

  return additions.join('\n')
}

/**
 * Build event-specific prompt additions
 */
export function buildEventPromptAdditions(filters?: {
  village?: string
  month?: string
  type?: string
}): string {
  const additions: string[] = [
    'Include annual festivals, religious celebrations, and local events.',
    'Note accurate dates or typical timing for recurring events.',
  ]

  if (filters?.village) {
    additions.push(`Focus on events in ${filters.village}.`)
  }
  if (filters?.month) {
    additions.push(`Focus on events happening in ${filters.month}.`)
  }
  if (filters?.type) {
    additions.push(`Focus on ${filters.type} type events.`)
  }

  return additions.join('\n')
}

/**
 * Build transportation-specific prompt additions
 */
export function buildTransportationPromptAdditions(): string {
  return [
    'Include train, ferry, and bus options.',
    'Provide accurate route information, frequencies, and typical prices.',
    'Note seasonal variations in service.',
    'Include the Cinque Terre Card information.',
  ].join('\n')
}

/**
 * Build region-specific prompt additions
 */
export function buildRegionPromptAdditions(): string {
  return [
    'Provide comprehensive overview of the Cinque Terre region.',
    'Include UNESCO World Heritage status information.',
    'Cover geography, climate, and best times to visit.',
    'Include practical information about visiting the region.',
  ].join('\n')
}

/**
 * Build weather-specific prompt additions
 */
export function buildWeatherPromptAdditions(filters?: {
  month?: string
  season?: string
}): string {
  const additions: string[] = [
    'Provide accurate seasonal weather patterns.',
    'Include typical temperatures, rainfall, and sea conditions.',
    'Note best activities for each weather condition.',
  ]

  if (filters?.month) {
    additions.push(`Focus on weather conditions in ${filters.month}.`)
  }
  if (filters?.season) {
    additions.push(`Focus on ${filters.season} season weather.`)
  }

  return additions.join('\n')
}
