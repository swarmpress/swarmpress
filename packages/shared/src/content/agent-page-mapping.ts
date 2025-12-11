/**
 * Agent-to-PageType Mapping
 * Maps page types to specialist writer agents based on their expertise
 */

export interface AgentPageMapping {
  /** Page types that this agent handles */
  pageTypes: string[]
  /** Agent name (matches agents.name in database) */
  agentName: string
  /** Priority (lower = higher priority when multiple agents match) */
  priority: number
  /** Fallback agent if primary is unavailable */
  fallbackAgentName?: string
}

/**
 * Agent-to-PageType mappings
 * Each agent has specific expertise areas
 */
export const AGENT_PAGE_MAPPINGS: AgentPageMapping[] = [
  // Giulia - Culinary expert, food writer
  // Voice: friendly, 1st person, informal, moderate humor
  {
    pageTypes: ['restaurants', 'food', 'dining', 'wine', 'local-cuisine'],
    agentName: 'Giulia',
    priority: 1,
    fallbackAgentName: 'Isabella',
  },

  // Isabella - Travel writer, adventure
  // Voice: enthusiastic, 2nd person, informal, evocative
  {
    pageTypes: [
      'hiking',
      'hikes',
      'beaches',
      'things-to-do',
      'activities',
      'events',
      'outdoor',
      'swimming',
      'snorkeling',
    ],
    agentName: 'Isabella',
    priority: 1,
    fallbackAgentName: 'Giulia',
  },

  // Lorenzo - Cultural historian
  // Voice: authoritative, 3rd person, formal, long sentences
  {
    pageTypes: ['overview', 'sights', 'history', 'culture', 'architecture', 'museums', 'churches'],
    agentName: 'Lorenzo',
    priority: 1,
    fallbackAgentName: 'Sophia',
  },

  // Sophia - Editorial leader
  // Voice: authoritative, 3rd person, formal, evocative
  {
    pageTypes: [
      'hotels',
      'accommodations',
      'apartments',
      'camping',
      'agriturismi',
      'bed-and-breakfast',
      'luxury',
    ],
    agentName: 'Sophia',
    priority: 1,
    fallbackAgentName: 'Isabella',
  },

  // Marco - Senior editor, practical info
  // Voice: professional, 3rd person, factual
  {
    pageTypes: ['faq', 'getting-here', 'transportation', 'maps', 'weather', 'practical-info', 'tips'],
    agentName: 'Marco',
    priority: 1,
    fallbackAgentName: 'Sophia',
  },

  // Francesca - Visual storyteller
  // Voice: casual, 1st person, short sentences
  {
    pageTypes: ['boat-tours', 'blog', 'insights', 'photography', 'instagram', 'sunset', 'views'],
    agentName: 'Francesca',
    priority: 1,
    fallbackAgentName: 'Isabella',
  },
]

/**
 * Get the best agent for a given page type
 * @param pageType - The page type (e.g., 'restaurants', 'hiking', 'overview')
 * @returns Agent name
 */
export function getAgentForPageType(pageType: string): string {
  const normalizedType = pageType.toLowerCase().trim()

  // Find exact or partial match
  const mapping = AGENT_PAGE_MAPPINGS.find((m) =>
    m.pageTypes.some(
      (pt) =>
        pt === normalizedType || normalizedType.includes(pt) || pt.includes(normalizedType)
    )
  )

  if (mapping) {
    return mapping.agentName
  }

  // Default fallback - Isabella is the most versatile travel writer
  return 'Isabella'
}

/**
 * Get the fallback agent for a given page type
 * @param pageType - The page type
 * @returns Fallback agent name or null
 */
export function getFallbackAgentForPageType(pageType: string): string | null {
  const normalizedType = pageType.toLowerCase().trim()

  const mapping = AGENT_PAGE_MAPPINGS.find((m) =>
    m.pageTypes.some(
      (pt) =>
        pt === normalizedType || normalizedType.includes(pt) || pt.includes(normalizedType)
    )
  )

  return mapping?.fallbackAgentName || null
}

/**
 * Get all page types handled by a specific agent
 * @param agentName - The agent name
 * @returns Array of page types
 */
export function getPageTypesForAgent(agentName: string): string[] {
  const mapping = AGENT_PAGE_MAPPINGS.find(
    (m) => m.agentName.toLowerCase() === agentName.toLowerCase()
  )

  return mapping?.pageTypes || []
}

/**
 * Get agent expertise description for prompts
 */
export function getAgentExpertise(agentName: string): string {
  const expertiseMap: Record<string, string> = {
    Giulia:
      'culinary expert specializing in Ligurian cuisine, local restaurants, wine, and food traditions',
    Isabella:
      'adventurous travel writer specializing in hiking trails, beaches, outdoor activities, and authentic experiences',
    Lorenzo:
      'cultural historian with deep knowledge of Mediterranean history, architecture, and local traditions',
    Sophia:
      'editorial leader specializing in accommodations, hospitality, and premium travel experiences',
    Marco: 'practical information specialist covering transportation, logistics, and travel tips',
    Francesca:
      'visual storyteller specializing in photography spots, scenic views, and Instagram-worthy locations',
  }

  return expertiseMap[agentName] || 'travel content specialist'
}

/**
 * Mapping of page types to relevant collection types
 * Used to determine which collections should be embedded in a page
 */
export const PAGE_TYPE_TO_COLLECTIONS: Record<string, string[]> = {
  restaurants: ['restaurants'],
  food: ['restaurants'],
  dining: ['restaurants'],
  hiking: ['hikes'],
  hikes: ['hikes'],
  beaches: ['pois'],
  'things-to-do': ['pois', 'events'],
  activities: ['pois', 'events'],
  events: ['events'],
  overview: ['villages', 'pois'],
  sights: ['pois'],
  history: ['villages'],
  hotels: ['accommodations'],
  accommodations: ['accommodations'],
  apartments: ['accommodations'],
  camping: ['accommodations'],
  agriturismi: ['accommodations'],
  faq: [],
  'getting-here': ['transportation'],
  transportation: ['transportation'],
  weather: ['weather'],
  'boat-tours': ['pois'],
  blog: [],
  insights: [],
}

/**
 * Get relevant collection types for a page type
 * @param pageType - The page type
 * @returns Array of collection types to embed
 */
export function getCollectionsForPageType(pageType: string): string[] {
  const normalizedType = pageType.toLowerCase().trim()
  return PAGE_TYPE_TO_COLLECTIONS[normalizedType] || []
}
