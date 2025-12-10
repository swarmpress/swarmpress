/**
 * Schema Transformer for Claude Structured Outputs
 *
 * Transforms JSON Schema from database to Claude Structured Outputs format.
 * Claude's structured outputs require specific constraints:
 * - additionalProperties: false on all objects
 * - minimum/maximum converted to descriptions (not enforced)
 * - No external $ref URLs
 */

// ============================================================================
// Types
// ============================================================================

type JsonSchema = {
  [key: string]: unknown
  type?: string
  properties?: Record<string, JsonSchema>
  patternProperties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  additionalItems?: JsonSchema | boolean
  additionalProperties?: boolean
  allOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
  if?: JsonSchema
  then?: JsonSchema
  else?: JsonSchema
  definitions?: Record<string, JsonSchema>
  $defs?: Record<string, JsonSchema>
  $ref?: string
  required?: string[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  description?: string
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// Main Transform Function
// ============================================================================

/**
 * Transform a JSON Schema to be compatible with Claude's Structured Outputs
 */
export function transformToStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  // Deep clone to avoid mutating original
  const transformed = JSON.parse(JSON.stringify(schema))

  // Handle schemas with definitions/$defs
  if (transformed.definitions) {
    for (const [key, def] of Object.entries(transformed.definitions)) {
      transformed.definitions[key] = transformSchemaNode(def as JsonSchema)
    }
  }
  if (transformed.$defs) {
    for (const [key, def] of Object.entries(transformed.$defs)) {
      transformed.$defs[key] = transformSchemaNode(def as JsonSchema)
    }
  }

  // Transform the main schema
  return transformSchemaNode(transformed)
}

/**
 * Recursively transform a schema node
 */
function transformSchemaNode(node: JsonSchema): JsonSchema {
  if (!node || typeof node !== 'object') {
    return node
  }

  const result = { ...node }

  // Handle $ref - if it's a local reference, keep it; if external, remove it
  if (typeof result.$ref === 'string') {
    if (result.$ref.startsWith('http://') || result.$ref.startsWith('https://')) {
      // External refs not supported - remove and return empty object
      delete result.$ref
      return { type: 'object', additionalProperties: false }
    }
  }

  // Handle type-specific transformations
  const type = result.type

  if (type === 'object' || (result.properties && !type)) {
    // Add additionalProperties: false for all objects
    result.additionalProperties = false

    // Transform all properties
    if (result.properties) {
      for (const [propName, propSchema] of Object.entries(result.properties)) {
        result.properties[propName] = transformSchemaNode(propSchema as JsonSchema)
      }
    }

    // Transform patternProperties
    if (result.patternProperties) {
      for (const [pattern, propSchema] of Object.entries(result.patternProperties)) {
        result.patternProperties[pattern] = transformSchemaNode(propSchema as JsonSchema)
      }
    }
  }

  if (type === 'array') {
    // Transform items schema
    if (result.items) {
      if (Array.isArray(result.items)) {
        result.items = result.items.map((item: JsonSchema) => transformSchemaNode(item))
      } else {
        result.items = transformSchemaNode(result.items as JsonSchema)
      }
    }

    // Transform additionalItems if present
    if (result.additionalItems && typeof result.additionalItems === 'object') {
      result.additionalItems = transformSchemaNode(result.additionalItems as JsonSchema)
    }
  }

  // Handle numeric constraints - convert to descriptions
  if (type === 'number' || type === 'integer') {
    const constraints: string[] = []

    if (typeof result.minimum === 'number') {
      constraints.push(`minimum: ${result.minimum}`)
      delete result.minimum
    }
    if (typeof result.maximum === 'number') {
      constraints.push(`maximum: ${result.maximum}`)
      delete result.maximum
    }
    if (typeof result.exclusiveMinimum === 'number') {
      constraints.push(`must be greater than ${result.exclusiveMinimum}`)
      delete result.exclusiveMinimum
    }
    if (typeof result.exclusiveMaximum === 'number') {
      constraints.push(`must be less than ${result.exclusiveMaximum}`)
      delete result.exclusiveMaximum
    }

    if (constraints.length > 0) {
      const existingDesc = typeof result.description === 'string' ? result.description + '. ' : ''
      result.description = existingDesc + 'Constraints: ' + constraints.join(', ')
    }
  }

  // Handle string constraints - convert minLength/maxLength to descriptions
  if (type === 'string') {
    const constraints: string[] = []

    if (typeof result.minLength === 'number' && result.minLength > 0) {
      constraints.push(`minimum ${result.minLength} character${result.minLength > 1 ? 's' : ''}`)
      delete result.minLength
    }
    if (typeof result.maxLength === 'number') {
      constraints.push(`maximum ${result.maxLength} characters`)
      delete result.maxLength
    }

    if (constraints.length > 0) {
      const existingDesc = typeof result.description === 'string' ? result.description + '. ' : ''
      result.description = existingDesc + 'Constraints: ' + constraints.join(', ')
    }
  }

  // Handle array constraints
  if (type === 'array') {
    const constraints: string[] = []

    if (typeof result.minItems === 'number' && result.minItems > 0) {
      constraints.push(`minimum ${result.minItems} item${result.minItems > 1 ? 's' : ''}`)
      delete result.minItems
    }
    if (typeof result.maxItems === 'number') {
      constraints.push(`maximum ${result.maxItems} items`)
      delete result.maxItems
    }

    if (constraints.length > 0) {
      const existingDesc = typeof result.description === 'string' ? result.description + '. ' : ''
      result.description = existingDesc + 'Constraints: ' + constraints.join(', ')
    }
  }

  // Handle allOf, anyOf, oneOf
  if (result.allOf && Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map((subSchema: JsonSchema) => transformSchemaNode(subSchema))
  }
  if (result.anyOf && Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((subSchema: JsonSchema) => transformSchemaNode(subSchema))
  }
  if (result.oneOf && Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map((subSchema: JsonSchema) => transformSchemaNode(subSchema))
  }

  // Handle not
  if (result.not && typeof result.not === 'object') {
    result.not = transformSchemaNode(result.not as JsonSchema)
  }

  // Handle if/then/else
  if (result.if && typeof result.if === 'object') {
    result.if = transformSchemaNode(result.if as JsonSchema)
  }
  if (result.then && typeof result.then === 'object') {
    result.then = transformSchemaNode(result.then as JsonSchema)
  }
  if (result.else && typeof result.else === 'object') {
    result.else = transformSchemaNode(result.else as JsonSchema)
  }

  return result
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a schema is compatible with Claude's Structured Outputs
 */
export function validateStructuredOutputSchema(schema: JsonSchema): ValidationResult {
  const errors: string[] = []

  validateNode(schema, '', errors)

  return {
    valid: errors.length === 0,
    errors
  }
}

function validateNode(node: JsonSchema, path: string, errors: string[]): void {
  if (!node || typeof node !== 'object') {
    return
  }

  // Check for external $ref
  if (typeof node.$ref === 'string') {
    if (node.$ref.startsWith('http://') || node.$ref.startsWith('https://')) {
      errors.push(`${path || 'root'}: External $ref not supported: ${node.$ref}`)
    }
  }

  const type = node.type

  // Check objects have additionalProperties: false
  if (type === 'object' || (node.properties && !type)) {
    if (node.additionalProperties !== false) {
      errors.push(`${path || 'root'}: Object must have additionalProperties: false`)
    }

    // Recurse into properties
    if (node.properties) {
      for (const [propName, propSchema] of Object.entries(node.properties)) {
        validateNode(propSchema as JsonSchema, `${path}.${propName}`, errors)
      }
    }
  }

  // Check arrays
  if (type === 'array' && node.items) {
    if (Array.isArray(node.items)) {
      node.items.forEach((item: JsonSchema, idx: number) => {
        validateNode(item, `${path}[${idx}]`, errors)
      })
    } else {
      validateNode(node.items as JsonSchema, `${path}[]`, errors)
    }
  }

  // Check unsupported numeric constraints
  if (type === 'number' || type === 'integer') {
    if (typeof node.minimum === 'number') {
      errors.push(`${path || 'root'}: numeric 'minimum' should be converted to description`)
    }
    if (typeof node.maximum === 'number') {
      errors.push(`${path || 'root'}: numeric 'maximum' should be converted to description`)
    }
  }

  // Check compositions
  const compositions = ['allOf', 'anyOf', 'oneOf'] as const
  for (const comp of compositions) {
    if (node[comp] && Array.isArray(node[comp])) {
      (node[comp] as JsonSchema[]).forEach((subSchema, idx) => {
        validateNode(subSchema, `${path}.${comp}[${idx}]`, errors)
      })
    }
  }

  // Check definitions
  if (node.definitions) {
    for (const [key, def] of Object.entries(node.definitions)) {
      validateNode(def as JsonSchema, `definitions.${key}`, errors)
    }
  }
  if (node.$defs) {
    for (const [key, def] of Object.entries(node.$defs)) {
      validateNode(def as JsonSchema, `$defs.${key}`, errors)
    }
  }
}

// ============================================================================
// Utility: Wrap Schema for Array Output
// ============================================================================

/**
 * Wrap a single-item schema in an array container for structured outputs.
 * Claude's structured outputs work best when returning a top-level object.
 */
export function wrapSchemaForArrayOutput(itemSchema: JsonSchema): JsonSchema {
  const transformedItem = transformToStructuredOutputSchema(itemSchema)

  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: transformedItem,
        description: 'Array of extracted items'
      }
    },
    required: ['items'],
    additionalProperties: false
  }
}

// ============================================================================
// Utility: Simplify Schema for Extraction (Structured Outputs Limit: 24 optional params)
// ============================================================================

/**
 * Simplify a schema for extraction by making all properties required but nullable.
 * This approach eliminates "optional" parameters by making everything required
 * with nullable types, which should avoid the grammar compilation efficiency issues.
 */
export function simplifySchemaForExtraction(schema: JsonSchema): JsonSchema {
  console.log(`[SchemaTransformer] Converting schema to all-required-nullable format`)

  const simplified = makeAllRequiredNullable(schema)
  return transformToStructuredOutputSchema(simplified)
}

/**
 * Convert a schema so all properties are required but allow null values.
 * This eliminates optional parameters while preserving schema structure.
 */
function makeAllRequiredNullable(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const result = { ...schema }
  const type = result.type

  if (type === 'object' || result.properties) {
    const properties = result.properties || {}
    const newProperties: Record<string, JsonSchema> = {}
    const allRequired: string[] = []

    for (const [propName, propSchema] of Object.entries(properties)) {
      const prop = propSchema as JsonSchema
      // Make the property nullable and recurse
      newProperties[propName] = makePropertyNullable(makeAllRequiredNullable(prop))
      allRequired.push(propName)
    }

    result.properties = newProperties
    result.required = allRequired
  }

  if (type === 'array' && result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map((item: JsonSchema) => makeAllRequiredNullable(item))
    } else {
      result.items = makeAllRequiredNullable(result.items as JsonSchema)
    }
  }

  return result
}

/**
 * Make a property schema nullable (allow null values).
 */
function makePropertyNullable(schema: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const type = schema.type

  // Already nullable
  if (Array.isArray(type) && type.includes('null')) {
    return schema
  }

  // Simple types - add null to type (use anyOf for type safety)
  if (typeof type === 'string' && ['string', 'number', 'integer', 'boolean'].includes(type)) {
    return {
      anyOf: [
        { type: type as string },
        { type: 'null' }
      ],
      description: schema.description
    }
  }

  // Object or array types - wrap in anyOf with null
  if (type === 'object' || type === 'array') {
    return {
      anyOf: [
        schema,
        { type: 'null' }
      ]
    }
  }

  // Enum types - add null to enum values
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(null)) {
      return { ...schema, enum: [...schema.enum, null] }
    }
    return schema
  }

  // anyOf/oneOf - add null option if not present
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const hasNull = schema.anyOf.some((s: JsonSchema) => s.type === 'null')
    if (!hasNull) {
      return { ...schema, anyOf: [...schema.anyOf, { type: 'null' }] }
    }
    return schema
  }

  // Default: wrap in anyOf with null
  return {
    anyOf: [
      schema,
      { type: 'null' }
    ]
  }
}

// ============================================================================
// Utility: Extract Core Schema from Definitions
// ============================================================================

/**
 * Extract the main schema from a JSON Schema that uses definitions/$ref pattern.
 * This is common when using zodToJsonSchema.
 */
export function extractCoreSchema(schema: JsonSchema): JsonSchema {
  // If schema has a $ref pointing to definitions, resolve it
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/definitions/')) {
    const defName = schema.$ref.replace('#/definitions/', '')
    if (schema.definitions && schema.definitions[defName]) {
      return schema.definitions[defName] as JsonSchema
    }
  }

  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const defName = schema.$ref.replace('#/$defs/', '')
    if (schema.$defs && schema.$defs[defName]) {
      return schema.$defs[defName] as JsonSchema
    }
  }

  return schema
}
