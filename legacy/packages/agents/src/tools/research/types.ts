/**
 * Shared types for the dynamic research system
 */

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolResult {
  success: boolean
  error?: string
  [key: string]: unknown
}

export interface WebSearchResult extends ToolResult {
  results: string
  collection_type: string
  query: string
  sources?: string[]
}

export interface ExtractDataResult extends ToolResult {
  items: Record<string, unknown>[]
  validation_errors: Array<{ field: string; error: string }>
  collection_type: string
}

export interface StoreItemsResult extends ToolResult {
  created: number
  skipped: number
  errors: Array<{ name: string; error: string }>
}

export interface ListCollectionsResult extends ToolResult {
  collections: Array<{
    type: string
    display_name: string
    singular_name?: string
    description?: string
  }>
}

// ============================================================================
// Tool Context Types
// ============================================================================

export interface ResearchToolContext {
  websiteId: string
  agentId?: string
  userId?: string
}

// ============================================================================
// Collection Types (from database)
// ============================================================================

export interface WebsiteCollectionInfo {
  id: string
  website_id: string
  collection_type: string
  display_name: string
  singular_name?: string
  json_schema: Record<string, unknown>
  field_metadata: Record<string, unknown>
  title_field: string
  summary_field?: string
}

export interface ResearchConfigInfo {
  id: string
  collection_id: string
  enabled: boolean
  search_prompt?: string
  default_queries: string[]
  search_domains?: string[]
  extraction_prompt?: string
  extraction_hints?: Record<string, unknown>
  validation_rules?: Record<string, unknown>
  require_source_urls: boolean
  min_confidence_score: number
  auto_publish: boolean
  dedup_strategy: 'name' | 'location' | 'composite'
}

export interface CollectionWithResearchConfig extends WebsiteCollectionInfo {
  research_config?: ResearchConfigInfo
}
