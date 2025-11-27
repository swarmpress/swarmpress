/**
 * Base Research Module
 * Provides core functionality for research using Claude API with web_search
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export interface ResearchOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ResearchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rawResponse?: string;
}

const DEFAULT_OPTIONS: ResearchOptions = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 32000,
  temperature: 0,
};

// ============================================================================
// Core Research Function
// ============================================================================

/**
 * Execute a research query using Claude API with web_search tool
 * This is the core function that powers all research tools
 */
export async function executeResearch<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: ResearchOptions = {}
): Promise<ResearchResult<T>> {
  const { model, maxTokens, temperature } = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Initialize Anthropic client
    const client = new Anthropic();

    // Execute the search with web_search tool
    const message = await client.messages.create({
      model: model!,
      max_tokens: maxTokens!,
      temperature: temperature,
      // @ts-expect-error - web_search tool type may not be in current SDK types
      tools: [{ type: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract text content from response
    let responseText = '';
    for (const block of message.content) {
      if (block.type === 'text') {
        responseText += block.text;
      }
    }

    // Parse JSON from response
    const jsonData = extractJSON(responseText);
    if (!jsonData) {
      return {
        success: false,
        error: 'No valid JSON found in response',
        rawResponse: responseText.substring(0, 500),
      };
    }

    // Validate against schema
    const parseResult = schema.safeParse(jsonData);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Schema validation failed: ${parseResult.error.message}`,
        rawResponse: JSON.stringify(jsonData).substring(0, 500),
      };
    }

    return {
      success: true,
      data: parseResult.data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Research] Error executing research:', errorMessage);
    return {
      success: false,
      error: `Research execution failed: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract JSON object from text response
 * Handles cases where JSON is wrapped in markdown code blocks or other text
 */
export function extractJSON(text: string): unknown | null {
  // First try to parse the entire text as JSON
  try {
    return JSON.parse(text.trim());
  } catch {
    // Continue to extraction methods
  }

  // Try to find JSON object in the text
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');

  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    try {
      return JSON.parse(jsonStr);
    } catch {
      // Try cleaning up the JSON
      const cleaned = cleanJSON(jsonStr);
      try {
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }

  // Try to find JSON array
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');

  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const jsonStr = text.substring(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Clean up malformed JSON
 */
function cleanJSON(str: string): string {
  return str
    .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
    .replace(/,\s*}/g, '}') // Remove trailing commas before }
    .replace(/,\s*]/g, ']') // Remove trailing commas before ]
    .replace(/'/g, '"') // Replace single quotes with double quotes
    .trim();
}

/**
 * Create a schema-based prompt for research
 * Converts a Zod schema to JSON schema format for the prompt
 */
export function createSchemaPrompt(
  task: string,
  location: string,
  schemaDescription: string
): string {
  return `${task}

Search Location: ${location}

Return results as a valid JSON object with this exact structure:

${schemaDescription}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Use null for genuinely unavailable data, not empty strings
3. Ensure all coordinates are accurate for the searched location
4. All prices should be in EUR as numbers
5. Times should be in 24-hour HH:MM format
6. Dates should be in ISO 8601 format (YYYY-MM-DD)
7. Sort results by relevance or rating where applicable
`;
}

// ============================================================================
// Exports
// ============================================================================

export default executeResearch;
