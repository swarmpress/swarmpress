import { z } from 'zod'

/**
 * Tool System Types
 * Types for the extensible tool system supporting REST, GraphQL, MCP, and JavaScript tools
 */

// ============================================================================
// Tool Types
// ============================================================================

export const ToolTypeSchema = z.enum(['rest', 'graphql', 'mcp', 'builtin', 'javascript'])
export type ToolType = z.infer<typeof ToolTypeSchema>

// ============================================================================
// Tool Config
// ============================================================================

const TimestampsSchema = z.object({
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

/**
 * REST tool configuration
 */
export const RestToolConfigSchema = z.object({
  headers: z.record(z.string()).optional(),
  auth_type: z.enum(['none', 'bearer', 'api_key', 'basic']).optional(),
  auth_header: z.string().optional(),
  default_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  timeout_ms: z.number().optional(),
})

export type RestToolConfig = z.infer<typeof RestToolConfigSchema>

/**
 * GraphQL tool configuration
 */
export const GraphQLToolConfigSchema = z.object({
  headers: z.record(z.string()).optional(),
  auth_type: z.enum(['none', 'bearer', 'api_key']).optional(),
  auth_header: z.string().optional(),
  default_query: z.string().optional(),
  timeout_ms: z.number().optional(),
})

export type GraphQLToolConfig = z.infer<typeof GraphQLToolConfigSchema>

/**
 * MCP (Model Context Protocol) tool configuration
 */
export const MCPToolConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  tools: z.array(z.string()).optional(), // Specific tools to expose, or all if empty
})

export type MCPToolConfig = z.infer<typeof MCPToolConfigSchema>

/**
 * Tool configuration stored in database
 */
export const ToolConfigSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    display_name: z.string().max(200).optional().nullable(),
    description: z.string().optional().nullable(),
    type: ToolTypeSchema,
    endpoint_url: z.string().url().optional().nullable(),
    config: z.record(z.unknown()).default({}),
    input_schema: z.record(z.unknown()).optional().nullable(),
  })
  .merge(TimestampsSchema)

export type ToolConfig = z.infer<typeof ToolConfigSchema>

/**
 * Input for creating a tool config
 */
export const CreateToolConfigSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().max(200).optional(),
  description: z.string().optional(),
  type: ToolTypeSchema,
  endpoint_url: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
  input_schema: z.record(z.unknown()).optional(),
})

export type CreateToolConfigInput = z.infer<typeof CreateToolConfigSchema>

/**
 * Input for updating a tool config
 */
export const UpdateToolConfigSchema = CreateToolConfigSchema.partial()

export type UpdateToolConfigInput = z.infer<typeof UpdateToolConfigSchema>

// ============================================================================
// Website Tool Binding
// ============================================================================

/**
 * Website-tool binding (NULL website_id = global)
 */
export const WebsiteToolSchema = z.object({
  id: z.string().uuid(),
  website_id: z.string().uuid().nullable(),
  tool_config_id: z.string().uuid(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  custom_config: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
})

export type WebsiteTool = z.infer<typeof WebsiteToolSchema>

/**
 * Website tool with joined tool config
 */
export const WebsiteToolWithConfigSchema = WebsiteToolSchema.extend({
  tool_config: ToolConfigSchema,
})

export type WebsiteToolWithConfig = z.infer<typeof WebsiteToolWithConfigSchema>

/**
 * Input for adding a tool to a website
 */
export const AddWebsiteToolSchema = z.object({
  website_id: z.string().uuid().nullable(), // null = global
  tool_config_id: z.string().uuid(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  custom_config: z.record(z.unknown()).optional(),
})

export type AddWebsiteToolInput = z.infer<typeof AddWebsiteToolSchema>

// ============================================================================
// Tool Secrets
// ============================================================================

/**
 * Tool secret (encrypted value stored in database)
 */
export const ToolSecretSchema = z.object({
  id: z.string().uuid(),
  website_id: z.string().uuid(),
  tool_config_id: z.string().uuid(),
  secret_key: z.string().min(1).max(100),
  // Note: encrypted_value is not exposed in types for security
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type ToolSecret = z.infer<typeof ToolSecretSchema>

/**
 * Input for setting a tool secret
 */
export const SetToolSecretSchema = z.object({
  website_id: z.string().uuid(),
  tool_config_id: z.string().uuid(),
  secret_key: z.string().min(1).max(100),
  value: z.string(), // Plain text value (will be encrypted before storage)
})

export type SetToolSecretInput = z.infer<typeof SetToolSecretSchema>

// ============================================================================
// Tool Scope
// ============================================================================

/**
 * Tool scope definition for filtering
 */
export const ToolScopeSchema = z.object({
  global: z.boolean().optional(),
  website_ids: z.array(z.string().uuid()).optional(),
  agent_types: z.array(z.string()).optional(),
})

export type ToolScope = z.infer<typeof ToolScopeSchema>

// ============================================================================
// External Tool Execution
// ============================================================================

/**
 * REST tool execution parameters
 */
export const RestToolParamsSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  path: z.string().optional(),
  query: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
})

export type RestToolParams = z.infer<typeof RestToolParamsSchema>

/**
 * GraphQL tool execution parameters
 */
export const GraphQLToolParamsSchema = z.object({
  query: z.string(),
  variables: z.record(z.unknown()).optional(),
  operation_name: z.string().optional(),
})

export type GraphQLToolParams = z.infer<typeof GraphQLToolParamsSchema>

/**
 * MCP tool execution parameters
 */
export const MCPToolParamsSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.unknown()).optional(),
})

export type MCPToolParams = z.infer<typeof MCPToolParamsSchema>

// ============================================================================
// JavaScript Tool Configuration
// ============================================================================

/**
 * Manifest field definition for JavaScript tool inputs/outputs
 */
export const ManifestFieldSchema = z.object({
  type: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
})

export type ManifestField = z.infer<typeof ManifestFieldSchema>

/**
 * JavaScript tool manifest (input/output schema)
 */
export const JavaScriptManifestSchema = z.object({
  input: z.record(ManifestFieldSchema),
  output: z.record(ManifestFieldSchema).optional(),
})

export type JavaScriptManifest = z.infer<typeof JavaScriptManifestSchema>

/**
 * JavaScript tool configuration stored in tool_configs.config
 */
export const JavaScriptToolConfigSchema = z.object({
  code: z.string().min(1),
  manifest: JavaScriptManifestSchema,
  timeout: z.number().min(100).max(30000).default(5000),
  allowAsync: z.boolean().default(true),
})

export type JavaScriptToolConfig = z.infer<typeof JavaScriptToolConfigSchema>

/**
 * Input for creating a JavaScript tool
 */
export const CreateJavaScriptToolSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().max(200).optional(),
  description: z.string().optional(),
  code: z.string().min(1),
  manifest: JavaScriptManifestSchema,
  timeout: z.number().min(100).max(30000).optional(),
  website_id: z.string().uuid().nullable().optional(), // null = global
})

export type CreateJavaScriptToolInput = z.infer<typeof CreateJavaScriptToolSchema>

/**
 * Input for updating a JavaScript tool
 */
export const UpdateJavaScriptToolSchema = z.object({
  code: z.string().min(1).optional(),
  manifest: JavaScriptManifestSchema.optional(),
  timeout: z.number().min(100).max(30000).optional(),
})

export type UpdateJavaScriptToolInput = z.infer<typeof UpdateJavaScriptToolSchema>

/**
 * Input for testing a JavaScript tool
 */
export const TestJavaScriptToolSchema = z.object({
  tool_id: z.string().uuid(),
  test_input: z.record(z.unknown()),
  website_id: z.string().uuid(), // For secrets
})

export type TestJavaScriptToolInput = z.infer<typeof TestJavaScriptToolSchema>
