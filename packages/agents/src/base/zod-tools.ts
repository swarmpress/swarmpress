/**
 * Zod-Based Tool Definitions
 *
 * Provides type-safe tool definitions using Zod schemas.
 * Automatically converts Zod schemas to JSON Schema for Claude API.
 *
 * Benefits:
 * - Type-safe input validation
 * - Automatic JSON Schema generation
 * - Better developer experience with TypeScript inference
 * - Runtime validation of tool inputs
 */

import { z, type ZodType, type ZodTypeAny } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type Anthropic from '@anthropic-ai/sdk'
import type { ToolContext, ToolResult, ToolHandler } from './tools'

// ============================================================================
// Types
// ============================================================================

/**
 * A Zod-defined tool with type-safe handler
 */
export interface ZodTool<TInput extends ZodTypeAny> {
  name: string
  description: string
  inputSchema: TInput
  handler: (input: z.infer<TInput>, context: ToolContext) => Promise<ToolResult>
}

/**
 * Result of converting a Zod tool to Anthropic format
 */
export interface ConvertedTool {
  definition: Anthropic.Tool
  handler: ToolHandler
}

// ============================================================================
// Tool Definition Utilities
// ============================================================================

/**
 * Define a tool using Zod schema
 *
 * @example
 * ```typescript
 * const getWeatherTool = defineZodTool(
 *   'get_weather',
 *   'Get the current weather for a location',
 *   z.object({
 *     location: z.string().describe('City name'),
 *     units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
 *   }),
 *   async (input, context) => {
 *     const weather = await fetchWeather(input.location, input.units)
 *     return { success: true, data: weather }
 *   }
 * )
 * ```
 */
export function defineZodTool<TInput extends ZodTypeAny>(
  name: string,
  description: string,
  inputSchema: TInput,
  handler: (input: z.infer<TInput>, context: ToolContext) => Promise<ToolResult>
): ZodTool<TInput> {
  return {
    name,
    description,
    inputSchema,
    handler,
  }
}

/**
 * Convert a Zod tool to Anthropic format
 * This creates the JSON Schema definition and wraps the handler with validation
 */
export function convertZodTool<TInput extends ZodTypeAny>(
  zodTool: ZodTool<TInput>
): ConvertedTool {
  // Convert Zod schema to JSON Schema
  const jsonSchema = zodToJsonSchema(zodTool.inputSchema, {
    $refStrategy: 'none',
    target: 'openApi3',
  })

  // Remove unsupported fields for Anthropic
  const cleanedSchema = cleanJsonSchema(jsonSchema)

  // Create Anthropic tool definition
  const definition: Anthropic.Tool = {
    name: zodTool.name,
    description: zodTool.description,
    input_schema: cleanedSchema as Anthropic.Tool.InputSchema,
  }

  // Create validating handler wrapper
  const handler: ToolHandler = async (input: unknown, context: ToolContext) => {
    try {
      // Validate input against Zod schema
      const parseResult = zodTool.inputSchema.safeParse(input)

      if (!parseResult.success) {
        const errors = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return {
          success: false,
          error: `Invalid input: ${errors}`,
        }
      }

      // Call the handler with validated input
      return await zodTool.handler(parseResult.data, context)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  return { definition, handler }
}

/**
 * Convert multiple Zod tools to Anthropic format
 */
export function convertZodTools(
  zodTools: ZodTool<ZodTypeAny>[]
): ConvertedTool[] {
  return zodTools.map(convertZodTool)
}

// ============================================================================
// JSON Schema Cleaning
// ============================================================================

/**
 * Clean JSON Schema to be compatible with Anthropic API
 * Removes unsupported fields and normalizes structure
 */
function cleanJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) {
    return {}
  }

  const obj = schema as Record<string, unknown>
  const cleaned: Record<string, unknown> = {}

  // Copy only supported fields
  const supportedFields = [
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'description',
    'default',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'pattern',
    'anyOf',
    'oneOf',
    'allOf',
  ]

  for (const field of supportedFields) {
    if (field in obj && obj[field] !== undefined) {
      if (field === 'properties' && typeof obj[field] === 'object') {
        // Recursively clean nested schemas
        const properties = obj[field] as Record<string, unknown>
        cleaned[field] = Object.fromEntries(
          Object.entries(properties).map(([key, value]) => [
            key,
            cleanJsonSchema(value),
          ])
        )
      } else if (field === 'items' && typeof obj[field] === 'object') {
        cleaned[field] = cleanJsonSchema(obj[field])
      } else if (
        (field === 'anyOf' || field === 'oneOf' || field === 'allOf') &&
        Array.isArray(obj[field])
      ) {
        cleaned[field] = (obj[field] as unknown[]).map(cleanJsonSchema)
      } else {
        cleaned[field] = obj[field]
      }
    }
  }

  return cleaned
}

// ============================================================================
// Common Schema Helpers
// ============================================================================

/**
 * Common schemas for tool inputs
 */
export const commonSchemas = {
  /** UUID string */
  uuid: z.string().uuid(),

  /** Non-empty string */
  nonEmptyString: z.string().min(1),

  /** Optional string with default */
  optionalString: (defaultValue = '') => z.string().default(defaultValue),

  /** Positive integer */
  positiveInt: z.number().int().positive(),

  /** Boolean with default */
  optionalBoolean: (defaultValue = false) => z.boolean().default(defaultValue),

  /** Pagination parameters */
  pagination: z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().min(1).max(100).default(20),
  }),

  /** Date string in ISO format */
  isoDate: z.string().datetime(),

  /** JSON content */
  jsonContent: z.record(z.unknown()),
}

// ============================================================================
// Tool Registry Integration
// ============================================================================

/**
 * Create a tool registry from Zod tools
 * Helper function to integrate with the existing ToolRegistry
 */
export function createToolRegistry(zodTools: ZodTool<ZodTypeAny>[]) {
  const converted = convertZodTools(zodTools)
  return {
    definitions: converted.map((t) => t.definition),
    handlers: Object.fromEntries(
      converted.map((t) => [t.definition.name, t.handler])
    ),
  }
}

// ============================================================================
// Example Tool Definitions (for reference)
// ============================================================================

/**
 * Example: Content retrieval tool using Zod
 */
export const exampleGetContentTool = defineZodTool(
  'get_content',
  'Retrieve a content item by ID',
  z.object({
    content_id: z.string().uuid().describe('The UUID of the content item'),
    include_body: z.boolean().default(true).describe('Whether to include the body'),
  }),
  async (input, _context) => {
    // This is just an example - actual implementation would fetch from database
    return {
      success: true,
      data: {
        id: input.content_id,
        title: 'Example Content',
        body: input.include_body ? [] : undefined,
      },
    }
  }
)

/**
 * Example: Content update tool using Zod
 */
export const exampleUpdateContentTool = defineZodTool(
  'update_content',
  'Update a content item',
  z.object({
    content_id: z.string().uuid().describe('The UUID of the content item'),
    title: z.string().min(1).max(200).optional().describe('New title'),
    body: z.array(z.record(z.unknown())).optional().describe('New body blocks'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  }),
  async (input, _context) => {
    // Example implementation
    return {
      success: true,
      data: {
        id: input.content_id,
        updated: true,
        fields: Object.keys(input).filter((k) => k !== 'content_id'),
      },
    }
  }
)
