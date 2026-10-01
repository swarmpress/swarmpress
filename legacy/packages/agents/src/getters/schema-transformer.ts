/**
 * Schema Transformer
 * Transforms JSON Schema to Claude Structured Outputs format
 */

type JsonSchema = Record<string, unknown>

/**
 * Transform a JSON Schema for Claude Structured Outputs
 * - Adds `additionalProperties: false` to all object types
 * - Converts min/max constraints to descriptions (not enforced by SO)
 * - Removes unsupported keywords
 */
export function transformToStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  // Deep clone to avoid mutating original
  const transformed = JSON.parse(JSON.stringify(schema))

  // Process the schema recursively
  processSchemaNode(transformed)

  return transformed
}

/**
 * Recursively process a schema node
 */
function processSchemaNode(node: JsonSchema): void {
  if (!node || typeof node !== 'object') return

  // Handle object types
  if (node.type === 'object') {
    // Add additionalProperties: false (required for SO)
    node.additionalProperties = false

    // Process properties
    if (node.properties && typeof node.properties === 'object') {
      for (const prop of Object.values(node.properties as Record<string, JsonSchema>)) {
        processSchemaNode(prop)
      }
    }

    // Process patternProperties (convert to regular properties or remove)
    if (node.patternProperties) {
      delete node.patternProperties
    }
  }

  // Handle array types
  if (node.type === 'array' && node.items) {
    if (Array.isArray(node.items)) {
      for (const item of node.items) {
        processSchemaNode(item as JsonSchema)
      }
    } else {
      processSchemaNode(node.items as JsonSchema)
    }
  }

  // Handle allOf/anyOf/oneOf
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(node[keyword])) {
      for (const subSchema of node[keyword] as JsonSchema[]) {
        processSchemaNode(subSchema)
      }
    }
  }

  // Handle definitions/$defs
  for (const defsKey of ['definitions', '$defs']) {
    if (node[defsKey] && typeof node[defsKey] === 'object') {
      for (const def of Object.values(node[defsKey] as Record<string, JsonSchema>)) {
        processSchemaNode(def)
      }
    }
  }

  // Convert numeric constraints to description text (not enforced by SO)
  convertNumericConstraints(node)

  // Remove unsupported keywords
  removeUnsupportedKeywords(node)
}

/**
 * Convert min/max constraints to description text
 * Structured outputs doesn't enforce these, so we add them to description
 */
function convertNumericConstraints(node: JsonSchema): void {
  const constraints: string[] = []

  if (typeof node.minimum === 'number') {
    constraints.push(`minimum: ${node.minimum}`)
    delete node.minimum
  }
  if (typeof node.maximum === 'number') {
    constraints.push(`maximum: ${node.maximum}`)
    delete node.maximum
  }
  if (typeof node.minLength === 'number') {
    constraints.push(`min length: ${node.minLength}`)
    delete node.minLength
  }
  if (typeof node.maxLength === 'number') {
    constraints.push(`max length: ${node.maxLength}`)
    delete node.maxLength
  }
  if (typeof node.minItems === 'number') {
    constraints.push(`min items: ${node.minItems}`)
    delete node.minItems
  }
  if (typeof node.maxItems === 'number') {
    constraints.push(`max items: ${node.maxItems}`)
    delete node.maxItems
  }

  // Append constraints to description
  if (constraints.length > 0) {
    const existing = typeof node.description === 'string' ? node.description : ''
    const constraintText = `[${constraints.join(', ')}]`
    node.description = existing ? `${existing} ${constraintText}` : constraintText
  }
}

/**
 * Remove keywords not supported by Claude Structured Outputs
 */
function removeUnsupportedKeywords(node: JsonSchema): void {
  const unsupported = [
    '$id',
    '$schema',
    '$ref',          // External refs - must be resolved beforehand
    'format',        // Not enforced
    'pattern',       // Not enforced
    'uniqueItems',   // Not enforced
    'contentMediaType',
    'contentEncoding',
    'if',
    'then',
    'else',
    'not',
  ]

  for (const keyword of unsupported) {
    delete node[keyword]
  }
}

/**
 * Wrap a schema for array output
 * Creates the standard { items: [...] } wrapper
 */
export function wrapSchemaForArrayOutput(itemSchema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: itemSchema
      }
    },
    required: ['items'],
    additionalProperties: false
  }
}

/**
 * Validate a schema is compatible with Structured Outputs
 * Returns issues that need to be addressed
 */
export function validateStructuredOutputSchema(schema: JsonSchema): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  function checkNode(node: JsonSchema, path: string): void {
    if (!node || typeof node !== 'object') return

    // Check for additionalProperties on objects
    if (node.type === 'object' && node.additionalProperties !== false) {
      issues.push(`${path}: object missing additionalProperties: false`)
    }

    // Check for external $ref
    if (typeof node.$ref === 'string' && node.$ref.startsWith('http')) {
      issues.push(`${path}: external $ref not supported`)
    }

    // Recurse into properties
    if (node.properties && typeof node.properties === 'object') {
      for (const [key, prop] of Object.entries(node.properties as Record<string, JsonSchema>)) {
        checkNode(prop, `${path}.${key}`)
      }
    }

    // Recurse into array items
    if (node.items) {
      if (Array.isArray(node.items)) {
        node.items.forEach((item, i) => checkNode(item as JsonSchema, `${path}[${i}]`))
      } else {
        checkNode(node.items as JsonSchema, `${path}[]`)
      }
    }

    // Check allOf/anyOf/oneOf
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(node[keyword])) {
        (node[keyword] as JsonSchema[]).forEach((sub, i) =>
          checkNode(sub, `${path}.${keyword}[${i}]`)
        )
      }
    }
  }

  checkNode(schema, 'root')

  return {
    valid: issues.length === 0,
    issues
  }
}
