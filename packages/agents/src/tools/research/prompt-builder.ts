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
 * Build an extraction prompt from collection schema and research config
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

  // Generate prompt from schema
  const schemaJson = JSON.stringify(simplifySchemaForPrompt(collection.json_schema), null, 2)
  const fieldHints = formatFieldHints(collection, config)

  return `Extract structured data for "${collection.display_name}" from the search results below.

## Output Format
Return a JSON array of objects. Each object represents one ${collection.singular_name || 'item'}.

## Schema Structure
Each item should follow this structure:
\`\`\`json
${schemaJson}
\`\`\`

## Field Guidance
${fieldHints || 'Follow the schema property descriptions for guidance on each field.'}

## Data Quality Requirements
- Only include items with verifiable information from the search results
- Include source URLs when available (store in a "source_url" field if not in schema)
- Use null for unknown values, not empty strings
- Ensure all required fields have valid values
${config?.require_source_urls ? '- Every item MUST have a source URL to be included' : ''}
${config?.min_confidence_score ? `- Only include items where you are at least ${Math.round(config.min_confidence_score * 100)}% confident in the data accuracy` : ''}

## Search Results
${searchResults}

## Output
Return ONLY a valid JSON array. No markdown code blocks, no explanatory text - just the JSON array.
If no valid items can be extracted, return an empty array: []`
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
 * Simplify JSON Schema for inclusion in prompts
 * Removes verbose metadata and focuses on structure
 */
function simplifySchemaForPrompt(schema: Record<string, unknown>): Record<string, unknown> {
  // Handle definitions-style schema
  if (schema.definitions) {
    const defs = schema.definitions as Record<string, unknown>
    const mainDef = Object.values(defs)[0] as Record<string, unknown>
    if (mainDef?.properties) {
      return simplifyProperties(mainDef.properties as Record<string, unknown>)
    }
  }

  // Handle direct properties
  if (schema.properties) {
    return simplifyProperties(schema.properties as Record<string, unknown>)
  }

  // Handle array schema
  if (schema.items) {
    const items = schema.items as Record<string, unknown>
    if (items.properties) {
      return simplifyProperties(items.properties as Record<string, unknown>)
    }
  }

  return schema
}

/**
 * Simplify properties object for prompt
 */
function simplifyProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const simplified: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(properties)) {
    const prop = value as Record<string, unknown>

    if (prop.type === 'object' && prop.properties) {
      simplified[key] = simplifyProperties(prop.properties as Record<string, unknown>)
    } else if (prop.type === 'array' && prop.items) {
      const items = prop.items as Record<string, unknown>
      if (items.properties) {
        simplified[key] = [simplifyProperties(items.properties as Record<string, unknown>)]
      } else {
        simplified[key] = [getTypeExample(items.type as string)]
      }
    } else {
      simplified[key] = getTypeExample(prop.type as string, prop.description as string)
    }
  }

  return simplified
}

/**
 * Get example value for a type
 */
function getTypeExample(type: string | undefined, description?: string): string {
  switch (type) {
    case 'string':
      return description ? `"${description.substring(0, 30)}..."` : '"string"'
    case 'number':
    case 'integer':
      return '0'
    case 'boolean':
      return 'true/false'
    case 'array':
      return '[]'
    case 'object':
      return '{}'
    default:
      return '"value"'
  }
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
