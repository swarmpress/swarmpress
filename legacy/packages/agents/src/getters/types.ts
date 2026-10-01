/**
 * Collection Getter Types
 */

export interface CollectionGetterOptions {
  websiteId: string
  collectionType: string
  agentPersona: string
  count?: number
  filters?: Record<string, unknown>
  promptAdditions?: string
}

export interface CollectionGetterResult<T = Record<string, unknown>> {
  success: boolean
  items: T[]
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface WebsiteCollectionInfo {
  id: string
  website_id: string
  collection_type: string
  display_name: string
  singular_name: string | null
  json_schema: Record<string, unknown>
  field_metadata: Record<string, unknown> | null
  title_field: string
  summary_field: string | null
}

export interface ResearchConfigInfo {
  id: string
  collection_id: string
  enabled: boolean
  search_prompt: string | null
  default_queries: string[] | null
  extraction_hints: Record<string, string> | null
  dedup_strategy: string | null
  auto_publish: boolean
}
