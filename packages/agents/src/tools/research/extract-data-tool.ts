/**
 * Extract Data Tool
 * Composable tool for extracting structured data from search results
 */

import Anthropic from '@anthropic-ai/sdk'
import Ajv from 'ajv'
import { db } from '@swarm-press/backend'
import { buildExtractionPrompt } from './prompt-builder'
import { extractJSON } from './base'
import type { ResearchToolContext, ExtractDataResult, WebsiteCollectionInfo, ResearchConfigInfo } from './types'

// ============================================================================
// Tool Definition
// ============================================================================

export const extractDataTool = {
  name: 'research_extract_data',
  description: 'Extract structured data from search results based on collection schema. Use after research_web_search.',
  input_schema: {
    type: 'object' as const,
    properties: {
      search_results: {
        type: 'string',
        description: 'Raw search results from research_web_search'
      },
      collection_type: {
        type: 'string',
        description: 'Collection type to extract data for'
      }
    },
    required: ['search_results', 'collection_type']
  }
}

// ============================================================================
// Tool Input Type
// ============================================================================

interface ExtractDataInput {
  search_results: string
  collection_type: string
}

// ============================================================================
// Tool Handler
// ============================================================================

/**
 * Extract structured data from search results
 */
export async function extractDataHandler(
  input: ExtractDataInput,
  context: ResearchToolContext
): Promise<ExtractDataResult> {
  const { search_results, collection_type } = input
  const { websiteId } = context

  try {
    // 1. Get collection and research config from database
    const collection = await getCollectionInfo(websiteId, collection_type)
    if (!collection) {
      return {
        success: false,
        error: `Collection '${collection_type}' not found for website`,
        items: [],
        validation_errors: [],
        collection_type
      }
    }

    const config = await getResearchConfig(collection.id)

    // 2. Build extraction prompt from schema + config
    const extractionPrompt = buildExtractionPrompt(search_results, collection, config)

    // 3. Call Claude to extract structured data
    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32000,
      temperature: 0,
      messages: [{ role: 'user', content: extractionPrompt }]
    })

    // 4. Extract text content from response
    let responseText = ''
    for (const block of message.content) {
      if (block.type === 'text') {
        responseText += block.text
      }
    }

    // 5. Parse JSON from response
    const jsonData = extractJSON(responseText)
    if (!jsonData) {
      return {
        success: false,
        error: 'No valid JSON found in extraction response',
        items: [],
        validation_errors: [{ field: '_response', error: 'Failed to parse JSON' }],
        collection_type
      }
    }

    // 6. Ensure we have an array
    const items = Array.isArray(jsonData) ? jsonData : [jsonData]

    // 7. Validate each item against schema
    const { valid, errors } = validateItems(items, collection.json_schema, config)

    return {
      success: true,
      items: valid,
      validation_errors: errors,
      collection_type
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[ExtractDataTool] Error:', errorMessage)
    return {
      success: false,
      error: `Extraction failed: ${errorMessage}`,
      items: [],
      validation_errors: [],
      collection_type
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  valid: Record<string, unknown>[]
  errors: Array<{ field: string; error: string }>
}

/**
 * Validate extracted items against JSON Schema
 */
function validateItems(
  items: unknown[],
  schema: Record<string, unknown>,
  config?: ResearchConfigInfo | null
): ValidationResult {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)

  const valid: Record<string, unknown>[] = []
  const errors: Array<{ field: string; error: string }> = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>

    // Basic schema validation
    const isValid = validate(item)

    if (!isValid && validate.errors) {
      for (const err of validate.errors) {
        errors.push({
          field: `item[${i}]${err.instancePath}`,
          error: err.message || 'Validation failed'
        })
      }
      continue
    }

    // Additional validation from config
    if (config?.require_source_urls && !item.source_url && !item.url) {
      errors.push({
        field: `item[${i}].source_url`,
        error: 'Source URL required but not provided'
      })
      continue
    }

    // Check confidence score if item has one
    if (config?.min_confidence_score && typeof item.confidence === 'number') {
      if (item.confidence < config.min_confidence_score) {
        errors.push({
          field: `item[${i}].confidence`,
          error: `Confidence ${item.confidence} below minimum ${config.min_confidence_score}`
        })
        continue
      }
    }

    // Custom validation rules
    if (config?.validation_rules) {
      const ruleErrors = applyCustomRules(item, config.validation_rules, i)
      if (ruleErrors.length > 0) {
        errors.push(...ruleErrors)
        continue
      }
    }

    valid.push(item)
  }

  return { valid, errors }
}

/**
 * Apply custom validation rules from config
 */
function applyCustomRules(
  item: Record<string, unknown>,
  rules: Record<string, unknown>,
  index: number
): Array<{ field: string; error: string }> {
  const errors: Array<{ field: string; error: string }> = []

  // Example rules: { "price": { "min": 0, "max": 10000 } }
  for (const [field, rule] of Object.entries(rules)) {
    const value = item[field]
    const r = rule as Record<string, unknown>

    if (r.required && (value === undefined || value === null)) {
      errors.push({ field: `item[${index}].${field}`, error: 'Required field missing' })
    }

    if (typeof value === 'number') {
      if (typeof r.min === 'number' && value < r.min) {
        errors.push({ field: `item[${index}].${field}`, error: `Value ${value} below minimum ${r.min}` })
      }
      if (typeof r.max === 'number' && value > r.max) {
        errors.push({ field: `item[${index}].${field}`, error: `Value ${value} above maximum ${r.max}` })
      }
    }

    if (typeof value === 'string') {
      if (typeof r.minLength === 'number' && value.length < r.minLength) {
        errors.push({ field: `item[${index}].${field}`, error: `String too short (min: ${r.minLength})` })
      }
      if (typeof r.pattern === 'string' && !new RegExp(r.pattern).test(value)) {
        errors.push({ field: `item[${index}].${field}`, error: `String doesn't match pattern ${r.pattern}` })
      }
    }
  }

  return errors
}

// ============================================================================
// Database Queries
// ============================================================================

async function getCollectionInfo(
  websiteId: string,
  collectionType: string
): Promise<WebsiteCollectionInfo | null> {
  const { rows } = await db.query<WebsiteCollectionInfo>(
    `SELECT id, website_id, collection_type, display_name, singular_name,
            json_schema, field_metadata, title_field, summary_field
     FROM website_collections
     WHERE website_id = $1 AND collection_type = $2 AND enabled = true`,
    [websiteId, collectionType]
  )
  return rows[0] || null
}

async function getResearchConfig(
  collectionId: string
): Promise<ResearchConfigInfo | null> {
  const { rows } = await db.query<ResearchConfigInfo>(
    `SELECT * FROM collection_research_config
     WHERE collection_id = $1 AND enabled = true`,
    [collectionId]
  )
  return rows[0] || null
}
