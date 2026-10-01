/**
 * Prompt Builder for Dynamic Research System
 * Generates prompts for web search and data extraction based on collection schemas
 */

import type { WebsiteCollectionInfo, ResearchConfigInfo } from './types'

// ============================================================================
// Search Prompt Builder
// ============================================================================

/**
 * Build a search prompt by enhancing user query with collection context
 */
export function buildSearchPrompt(
  query: string,
  collection: WebsiteCollectionInfo,
  config?: ResearchConfigInfo | null
): string {
  // If collection has a custom search prompt, use it
  if (config?.search_prompt) {
    return `${config.search_prompt}

User Query: ${query}

Search for current, accurate information about ${collection.display_name}.`
  }

  // Build a default search prompt based on collection type
  return `Search for detailed information about ${query}.

Context: Looking for ${collection.display_name} (${collection.singular_name || 'items'}).

Return comprehensive, accurate, and current information. Include:
- Names and descriptions
- Locations and contact details if applicable
- Relevant attributes and characteristics
- Any ratings, reviews, or recommendations`
}

// ============================================================================
// Extraction Prompt Builder
// ============================================================================

/**
 * Build an extraction prompt from collection schema and research config.
 * Note: Schema enforcement is now handled by Claude's structured outputs API,
 * so the prompt focuses on extraction quality rather than format instructions.
 */
export function buildExtractionPrompt(
  searchResults: string,
  collection: WebsiteCollectionInfo,
  config?: ResearchConfigInfo | null
): string {
  // Use custom extraction prompt if configured
  if (config?.extraction_prompt) {
    return config.extraction_prompt
      .replace('{{search_results}}', searchResults)
      .replace('{{schema}}', JSON.stringify(collection.json_schema, null, 2))
      .replace('{{field_hints}}', formatFieldHints(collection, config))
      .replace('{{collection_name}}', collection.display_name)
      .replace('{{singular_name}}', collection.singular_name || 'item')
  }

  const fieldHints = formatFieldHints(collection, config)

  // Simplified prompt - structured outputs API handles schema compliance
  return `Extract ${collection.display_name} from the search results below.

## Task
Extract all ${collection.singular_name || 'items'} found in the search results. The output schema is enforced automatically - focus on finding accurate data.

## Field Guidance
${fieldHints || 'Fill in all fields accurately based on the search results.'}

## Data Quality Requirements
- Only include items with verifiable information from the search results
- Include source_url for each item when the URL is available in the results
- Use null for genuinely unknown values, not empty strings or placeholder text
- Ensure accuracy - only extract data that is clearly stated in the results
${config?.require_source_urls ? '- Every item MUST have a source_url to be included' : ''}
${config?.min_confidence_score ? `- Only include items where you are at least ${Math.round(config.min_confidence_score * 100)}% confident in the data accuracy` : ''}

## Search Results
${searchResults}

Extract all valid ${collection.singular_name || 'items'} now.`
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format field hints from collection metadata and research config
 */
export function formatFieldHints(
  collection: WebsiteCollectionInfo,
  config?: ResearchConfigInfo | null
): string {
  const hints: string[] = []

  // Add hints from field_metadata
  if (collection.field_metadata) {
    for (const [field, meta] of Object.entries(collection.field_metadata)) {
      const m = meta as { description?: string; required?: boolean; hint?: string }
      if (m.description || m.hint) {
        hints.push(`- **${field}**: ${m.hint || m.description}${m.required ? ' (required)' : ''}`)
      }
    }
  }

  // Add hints from extraction_hints config
  if (config?.extraction_hints) {
    for (const [field, hint] of Object.entries(config.extraction_hints)) {
      hints.push(`- **${field}**: ${hint}`)
    }
  }

  return hints.length > 0 ? hints.join('\n') : 'Use schema property descriptions as guidance.'
}

/**
 * Build a validation prompt for checking extracted data
 */
export function buildValidationPrompt(
  items: Record<string, unknown>[],
  collection: WebsiteCollectionInfo,
  config?: ResearchConfigInfo | null
): string {
  return `Validate the following extracted data for "${collection.display_name}".

## Items to Validate
\`\`\`json
${JSON.stringify(items, null, 2)}
\`\`\`

## Schema Requirements
${JSON.stringify(collection.json_schema, null, 2)}

## Validation Rules
- Check all required fields are present and non-null
- Verify data types match schema expectations
- Ensure values are reasonable and consistent
${config?.validation_rules ? `- Additional rules: ${JSON.stringify(config.validation_rules)}` : ''}

Return a JSON object with:
{
  "valid": [...items that pass validation...],
  "invalid": [...items that fail validation with reasons...]
}`
}
