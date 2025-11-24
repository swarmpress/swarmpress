import { z } from 'zod'

/**
 * Prompt Engineering & Management Types
 * Three-level hierarchy: Company → Website → Agent
 */

// ============================================================================
// Prompt Examples
// ============================================================================

export const PromptExampleSchema = z.object({
  id: z.string(),
  quality: z.enum(['excellent', 'good', 'acceptable', 'poor']),
  brief: z.string(),
  output: z.string(),
  reasoning: z.string(),
  context: z.object({
    website: z.string().optional(),
    date: z.string().datetime().optional(),
    agent: z.string().optional(),
    quality_score: z.number().optional(),
    published: z.boolean().optional()
  }).optional()
})

export type PromptExample = z.infer<typeof PromptExampleSchema>

// ============================================================================
// Level 1: Company Prompt Templates
// ============================================================================

export const CompanyPromptTemplateSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  role_name: z.string(),  // 'writer', 'editor', 'seo', etc.
  capability: z.string(),  // 'write_draft', 'review_content', etc.
  version: z.string(),  // Semantic versioning: "1.0.0"

  // Prompt content
  template: z.string(),
  examples: z.array(PromptExampleSchema).optional(),
  default_variables: z.record(z.any()).optional(),

  // Metadata
  description: z.string().optional(),
  changelog: z.string().optional(),
  created_by_user_id: z.string().uuid().optional(),
  approved_by_user_id: z.string().uuid().optional(),
  approved_at: z.string().datetime().optional(),

  // Status
  is_active: z.boolean(),
  is_deprecated: z.boolean().optional(),
  deprecation_reason: z.string().optional(),

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})

export type CompanyPromptTemplate = z.infer<typeof CompanyPromptTemplateSchema>

export const CreateCompanyPromptTemplateSchema = z.object({
  company_id: z.string().uuid(),
  role_name: z.string(),
  capability: z.string(),
  version: z.string(),
  template: z.string(),
  examples: z.array(PromptExampleSchema).optional(),
  default_variables: z.record(z.any()).optional(),
  description: z.string().optional(),
  changelog: z.string().optional()
})

export type CreateCompanyPromptTemplate = z.infer<typeof CreateCompanyPromptTemplateSchema>

// ============================================================================
// Level 2: Website Prompt Templates
// ============================================================================

export const WebsitePromptTemplateSchema = z.object({
  id: z.string().uuid(),
  website_id: z.string().uuid(),
  company_prompt_template_id: z.string().uuid(),
  version: z.string(),

  // Override options
  template_override: z.string().optional(),
  template_additions: z.string().optional(),
  examples_override: z.array(PromptExampleSchema).optional(),
  variables_override: z.record(z.any()).optional(),

  // Metadata
  description: z.string().optional(),
  changelog: z.string().optional(),
  created_by_user_id: z.string().uuid().optional(),
  approved_by_user_id: z.string().uuid().optional(),
  approved_at: z.string().datetime().optional(),

  // Status
  is_active: z.boolean(),
  is_deprecated: z.boolean().optional(),
  deprecation_reason: z.string().optional(),

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})

export type WebsitePromptTemplate = z.infer<typeof WebsitePromptTemplateSchema>

export const CreateWebsitePromptTemplateSchema = z.object({
  website_id: z.string().uuid(),
  company_prompt_template_id: z.string().uuid(),
  version: z.string(),
  template_override: z.string().optional(),
  template_additions: z.string().optional(),
  examples_override: z.array(PromptExampleSchema).optional(),
  variables_override: z.record(z.any()).optional(),
  description: z.string().optional(),
  changelog: z.string().optional()
})

export type CreateWebsitePromptTemplate = z.infer<typeof CreateWebsitePromptTemplateSchema>

// ============================================================================
// Level 3: Agent Prompt Bindings
// ============================================================================

export const AgentPromptBindingSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  capability: z.string(),

  // Bind to either company or website prompt
  company_prompt_template_id: z.string().uuid().optional(),
  website_prompt_template_id: z.string().uuid().optional(),

  // Agent customizations
  custom_variables: z.record(z.any()).optional(),

  // A/B testing
  ab_test_group: z.string().optional(),
  ab_test_weight: z.number().min(0).max(1).optional(),

  // Status
  is_active: z.boolean(),

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
})

export type AgentPromptBinding = z.infer<typeof AgentPromptBindingSchema>

export const CreateAgentPromptBindingSchema = z.object({
  agent_id: z.string().uuid(),
  capability: z.string(),
  company_prompt_template_id: z.string().uuid().optional(),
  website_prompt_template_id: z.string().uuid().optional(),
  custom_variables: z.record(z.any()).optional(),
  ab_test_group: z.string().optional(),
  ab_test_weight: z.number().min(0).max(1).optional()
}).refine(
  data => (data.company_prompt_template_id || data.website_prompt_template_id) &&
          !(data.company_prompt_template_id && data.website_prompt_template_id),
  { message: 'Must bind to exactly one prompt source (company or website)' }
)

export type CreateAgentPromptBinding = z.infer<typeof CreateAgentPromptBindingSchema>

// ============================================================================
// Prompt Execution Logging
// ============================================================================

export const PromptExecutionSchema = z.object({
  id: z.string().uuid(),

  // Context
  agent_id: z.string().uuid(),
  capability: z.string(),
  company_prompt_template_id: z.string().uuid().optional(),
  website_prompt_template_id: z.string().uuid().optional(),

  // Input/Output
  input_variables: z.record(z.any()),
  final_prompt_hash: z.string().optional(),
  output: z.string().optional(),

  // Performance metrics
  tokens_used: z.number().optional(),
  latency_ms: z.number().optional(),
  claude_model: z.string().optional(),

  // Quality metrics
  quality_score: z.number().min(0).max(5).optional(),
  quality_rated_by: z.string().optional(),
  quality_rated_at: z.string().datetime().optional(),
  quality_feedback: z.string().optional(),

  // Content outcomes
  content_id: z.string().uuid().optional(),
  content_status: z.string().optional(),
  revision_count: z.number().optional(),

  // Error tracking
  error_occurred: z.boolean(),
  error_message: z.string().optional(),

  // A/B testing
  ab_test_group: z.string().optional(),

  // Timestamps
  created_at: z.string().datetime()
})

export type PromptExecution = z.infer<typeof PromptExecutionSchema>

export const CreatePromptExecutionSchema = z.object({
  agent_id: z.string().uuid(),
  capability: z.string(),
  company_prompt_template_id: z.string().uuid().optional(),
  website_prompt_template_id: z.string().uuid().optional(),
  input_variables: z.record(z.any()),
  final_prompt_hash: z.string().optional(),
  output: z.string().optional(),
  tokens_used: z.number().optional(),
  latency_ms: z.number().optional(),
  claude_model: z.string().optional(),
  error_occurred: z.boolean().default(false),
  error_message: z.string().optional(),
  ab_test_group: z.string().optional()
})

export type CreatePromptExecution = z.infer<typeof CreatePromptExecutionSchema>

// ============================================================================
// Resolved Prompt (Runtime)
// ============================================================================

export interface ResolvedPrompt {
  // Final merged content
  template: string
  examples: PromptExample[]
  variables: Record<string, any>

  // Metadata for tracking
  company_prompt_id: string
  company_version: string
  website_prompt_id?: string
  website_version?: string
  agent_customizations: Record<string, any>
  resolution_path: string[]  // ["company:1.0.0", "website:1.2.0", "agent:custom"]
}

export interface RenderPromptOptions {
  agent_id: string
  capability: string
  runtime_variables?: Record<string, any>
}

// ============================================================================
// Prompt Performance Metrics
// ============================================================================

export interface PromptPerformanceMetrics {
  prompt_id: string
  role_name: string
  capability: string
  website_name?: string

  // Execution stats
  total_executions: number
  successful_executions: number
  failed_executions: number

  // Quality metrics
  avg_quality_score: number
  quality_stddev: number
  high_quality_count: number  // Score >= 4.0
  low_quality_count: number   // Score < 3.0

  // Performance metrics
  avg_tokens: number
  avg_latency_ms: number

  // Content outcomes
  avg_revisions: number
  published_count: number
  rejected_count: number

  // Time range
  first_execution: string
  last_execution: string
}
