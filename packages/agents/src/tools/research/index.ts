/**
 * Research Tools Index
 *
 * Dynamic, database-driven research tools for website collections.
 * Tools are loaded based on website configuration - no static collection definitions.
 */

// ============================================================================
// Base Utilities
// ============================================================================

export {
  extractJSON,
  createSchemaPrompt,
  type ResearchOptions,
  type ResearchResult,
} from './base'

// ============================================================================
// Dynamic Tool System Types
// ============================================================================

export type {
  // Tool result types
  ToolResult,
  WebSearchResult,
  ExtractDataResult,
  StoreItemsResult,
  ListCollectionsResult,
  // Context types
  ResearchToolContext,
  // Database types
  WebsiteCollectionInfo,
  ResearchConfigInfo,
} from './types'

// ============================================================================
// Dynamic Tool Registry
// ============================================================================

export {
  // Main functions for dynamic tool loading
  getResearchToolsForWebsite,
  handleResearchToolCall,
  isResearchTool,
  getToolDefinitions,
  // Types
  type ResearchTool,
  type ResearchToolHandler,
} from './tool-registry'

// ============================================================================
// Composable Tools (for direct use if needed)
// ============================================================================

export { webSearchTool, webSearchHandler } from './web-search-tool'
export { extractDataTool, extractDataHandler } from './extract-data-tool'
export { storeItemsTool, storeItemsHandler } from './store-items-tool'

// ============================================================================
// Prompt Builders
// ============================================================================

export {
  buildSearchPrompt,
  buildExtractionPrompt,
  buildValidationPrompt,
} from './prompt-builder'

// ============================================================================
// Schema Transformer (for Claude Structured Outputs)
// ============================================================================

export {
  transformToStructuredOutputSchema,
  validateStructuredOutputSchema,
  wrapSchemaForArrayOutput,
  extractCoreSchema,
} from './schema-transformer'
