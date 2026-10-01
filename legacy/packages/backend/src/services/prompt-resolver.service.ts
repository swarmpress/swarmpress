/**
 * Prompt Resolver Service
 *
 * Resolves prompts through the three-level hierarchy:
 * Company (baseline) → Website (brand override) → Agent (individual)
 *
 * This is the core runtime component that determines what prompt an agent
 * actually receives when executing a capability.
 */

import { db } from '../db'
import Handlebars from 'handlebars'
import crypto from 'crypto'
import type {
  ResolvedPrompt,
  RenderPromptOptions,
  PromptExample,
  CompanyPromptTemplate,
  WebsitePromptTemplate,
  AgentPromptBinding
} from '@swarm-press/shared'

/**
 * Resolves and renders a prompt for an agent capability
 *
 * Algorithm:
 * 1. Load agent binding (agent_id + capability)
 * 2. Load company prompt template
 * 3. If website override exists, load it
 * 4. Merge templates (website can override or extend)
 * 5. Merge examples (website can override or append)
 * 6. Merge variables with priority: runtime > agent > website > company
 * 7. Render final prompt with Handlebars
 * 8. Return ResolvedPrompt with metadata
 */
export async function resolvePrompt(
  options: RenderPromptOptions
): Promise<ResolvedPrompt> {
  const { agent_id, capability, runtime_variables = {} } = options

  // Step 1: Load agent binding
  const binding = await loadAgentBinding(agent_id, capability)
  if (!binding) {
    throw new Error(
      `No prompt binding found for agent ${agent_id} with capability ${capability}`
    )
  }

  if (!binding.is_active) {
    throw new Error(
      `Prompt binding is inactive for agent ${agent_id} with capability ${capability}`
    )
  }

  // Step 2: Determine resolution path (Company or Website)
  let companyPrompt: CompanyPromptTemplate
  let websitePrompt: WebsitePromptTemplate | null = null
  const resolutionPath: string[] = []

  if (binding.company_prompt_template_id) {
    // Direct company binding
    companyPrompt = await loadCompanyPrompt(binding.company_prompt_template_id)
    resolutionPath.push(`company:${companyPrompt.version}`)
  } else if (binding.website_prompt_template_id) {
    // Website binding (which references company)
    websitePrompt = await loadWebsitePrompt(binding.website_prompt_template_id)
    companyPrompt = await loadCompanyPrompt(websitePrompt.company_prompt_template_id)
    resolutionPath.push(`company:${companyPrompt.version}`)
    resolutionPath.push(`website:${websitePrompt.version}`)
  } else {
    throw new Error('Binding has no valid prompt reference')
  }

  // Step 3: Merge templates
  let finalTemplate: string
  if (websitePrompt?.template_override) {
    // Website completely overrides template
    finalTemplate = websitePrompt.template_override
  } else if (websitePrompt?.template_additions) {
    // Website extends template
    finalTemplate = `${companyPrompt.template}\n\n${websitePrompt.template_additions}`
  } else {
    // Use company template as-is
    finalTemplate = companyPrompt.template
  }

  // Step 4: Merge examples
  let finalExamples: PromptExample[] = []
  const companyExamples = (companyPrompt.examples as PromptExample[] | undefined) || []
  const websiteExamples = (websitePrompt?.examples_override as PromptExample[] | undefined) || []

  if (websitePrompt && websiteExamples.length > 0) {
    // Website overrides examples
    finalExamples = websiteExamples
  } else {
    // Use company examples
    finalExamples = companyExamples
  }

  // Step 5: Merge variables with priority (runtime > agent > website > company)
  const companyVars = (companyPrompt.default_variables as Record<string, any>) || {}
  const websiteVars = (websitePrompt?.variables_override as Record<string, any>) || {}
  const agentVars = (binding.custom_variables as Record<string, any>) || {}

  const finalVariables = {
    ...companyVars,      // Lowest priority
    ...websiteVars,      // Override company
    ...agentVars,        // Override website
    ...runtime_variables // Highest priority (runtime overrides all)
  }

  // Step 6: Add agent customizations to resolution path
  if (Object.keys(agentVars).length > 0) {
    resolutionPath.push('agent:custom')
  }

  // Step 7: Build resolved prompt
  const resolved: ResolvedPrompt = {
    template: finalTemplate,
    examples: finalExamples,
    variables: finalVariables,
    company_prompt_id: companyPrompt.id,
    company_version: companyPrompt.version,
    website_prompt_id: websitePrompt?.id,
    website_version: websitePrompt?.version,
    agent_customizations: agentVars,
    resolution_path: resolutionPath
  }

  return resolved
}

/**
 * Renders a resolved prompt by substituting variables with Handlebars
 */
export function renderPrompt(resolved: ResolvedPrompt): string {
  const template = Handlebars.compile(resolved.template)
  return template(resolved.variables)
}

/**
 * Full pipeline: resolve + render in one step
 */
export async function resolveAndRender(
  options: RenderPromptOptions
): Promise<{ prompt: string; resolved: ResolvedPrompt }> {
  const resolved = await resolvePrompt(options)
  const prompt = renderPrompt(resolved)
  return { prompt, resolved }
}

/**
 * Generate hash of final rendered prompt (for tracking in executions)
 */
export function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 16)
}

// ============================================================================
// Database Queries
// ============================================================================

async function loadAgentBinding(
  agent_id: string,
  capability: string
): Promise<AgentPromptBinding | null> {
  const result = await db.query<AgentPromptBinding>(
    `SELECT * FROM agent_prompt_bindings
     WHERE agent_id = $1 AND capability = $2
     LIMIT 1`,
    [agent_id, capability]
  )
  return result.rows[0] || null
}

async function loadCompanyPrompt(
  id: string
): Promise<CompanyPromptTemplate> {
  const result = await db.query<CompanyPromptTemplate>(
    `SELECT * FROM company_prompt_templates WHERE id = $1`,
    [id]
  )

  if (result.rows.length === 0) {
    throw new Error(`Company prompt template not found: ${id}`)
  }

  const prompt = result.rows[0]

  if (!prompt.is_active) {
    throw new Error(`Company prompt template is inactive: ${id}`)
  }

  return prompt
}

async function loadWebsitePrompt(
  id: string
): Promise<WebsitePromptTemplate> {
  const result = await db.query<WebsitePromptTemplate>(
    `SELECT * FROM website_prompt_templates WHERE id = $1`,
    [id]
  )

  if (result.rows.length === 0) {
    throw new Error(`Website prompt template not found: ${id}`)
  }

  const prompt = result.rows[0]

  if (!prompt.is_active) {
    throw new Error(`Website prompt template is inactive: ${id}`)
  }

  return prompt
}

// ============================================================================
// Execution Logging
// ============================================================================

/**
 * Log prompt execution for performance tracking and analytics
 */
export async function logExecution(params: {
  agent_id: string
  capability: string
  resolved: ResolvedPrompt
  output?: string
  tokens_used?: number
  latency_ms?: number
  claude_model?: string
  error_occurred?: boolean
  error_message?: string
  content_id?: string
  ab_test_group?: string
}): Promise<string> {
  const {
    agent_id,
    capability,
    resolved,
    output,
    tokens_used,
    latency_ms,
    claude_model,
    error_occurred = false,
    error_message,
    content_id,
    ab_test_group
  } = params

  const renderedPrompt = renderPrompt(resolved)
  const promptHash = hashPrompt(renderedPrompt)

  const result = await db.query<{ id: string }>(
    `INSERT INTO prompt_executions (
      agent_id,
      capability,
      company_prompt_template_id,
      website_prompt_template_id,
      input_variables,
      final_prompt_hash,
      output,
      tokens_used,
      latency_ms,
      claude_model,
      error_occurred,
      error_message,
      content_id,
      ab_test_group
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id`,
    [
      agent_id,
      capability,
      resolved.company_prompt_id,
      resolved.website_prompt_id || null,
      JSON.stringify(resolved.variables),
      promptHash,
      output || null,
      tokens_used || null,
      latency_ms || null,
      claude_model || null,
      error_occurred,
      error_message || null,
      content_id || null,
      ab_test_group || null
    ]
  )

  return result.rows[0].id
}

/**
 * Update execution with quality rating (typically done post-hoc)
 */
export async function rateExecution(
  execution_id: string,
  quality_score: number,
  rated_by: string,
  feedback?: string
): Promise<void> {
  await db.query(
    `UPDATE prompt_executions
     SET quality_score = $1,
         quality_rated_by = $2,
         quality_rated_at = NOW(),
         quality_feedback = $3
     WHERE id = $4`,
    [quality_score, rated_by, feedback || null, execution_id]
  )
}

// ============================================================================
// A/B Testing Support
// ============================================================================

/**
 * Select prompt binding based on A/B test weights
 * If agent has multiple bindings for same capability with different ab_test_groups,
 * this selects one based on weights
 */
export async function selectBindingWithABTest(
  agent_id: string,
  capability: string
): Promise<AgentPromptBinding> {
  const result = await db.query<AgentPromptBinding>(
    `SELECT * FROM agent_prompt_bindings
     WHERE agent_id = $1
       AND capability = $2
       AND is_active = TRUE
     ORDER BY ab_test_weight DESC`,
    [agent_id, capability]
  )

  if (result.rows.length === 0) {
    throw new Error(`No active binding found for agent ${agent_id}, capability ${capability}`)
  }

  if (result.rows.length === 1 || !result.rows[0].ab_test_group) {
    // No A/B test, return single binding
    return result.rows[0]
  }

  // A/B test: weighted random selection
  const totalWeight = result.rows.reduce((sum, b) => sum + (Number(b.ab_test_weight) || 0), 0)
  const random = Math.random() * totalWeight

  let cumulativeWeight = 0
  for (const binding of result.rows) {
    cumulativeWeight += Number(binding.ab_test_weight) || 0
    if (random <= cumulativeWeight) {
      return binding
    }
  }

  // Fallback (shouldn't reach here)
  return result.rows[0]
}
