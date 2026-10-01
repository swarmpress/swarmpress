/**
 * Prompt Management API Router
 *
 * Comprehensive API for managing prompts across the three-level hierarchy:
 * Company (Level 1) → Website (Level 2) → Agent (Level 3)
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure, ceoProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import {
  resolvePrompt,
  renderPrompt,
  resolveAndRender,
  logExecution,
  rateExecution,
  selectBindingWithABTest
} from '../../services/prompt-resolver.service'
import {
  CreateCompanyPromptTemplateSchema,
  CreateWebsitePromptTemplateSchema,
  CreateAgentPromptBindingSchema,
  CreatePromptExecutionSchema,
  CompanyPromptTemplate,
  WebsitePromptTemplate,
  AgentPromptBinding,
  PromptExecution
} from '@swarm-press/shared'

export const promptRouter = router({
  // ============================================================================
  // Company Prompt Templates (Level 1 - Baseline)
  // ============================================================================

  company: router({
    /**
     * List all company prompt templates for a company
     */
    list: publicProcedure
      .input(
        z.object({
          company_id: z.string().uuid(),
          role_name: z.string().optional(),
          capability: z.string().optional(),
          is_active: z.boolean().optional()
        })
      )
      .query(async ({ input }) => {
        let query = `SELECT * FROM company_prompt_templates WHERE company_id = $1`
        const params: any[] = [input.company_id]
        let paramIndex = 2

        if (input.role_name) {
          query += ` AND role_name = $${paramIndex}`
          params.push(input.role_name)
          paramIndex++
        }

        if (input.capability) {
          query += ` AND capability = $${paramIndex}`
          params.push(input.capability)
          paramIndex++
        }

        if (input.is_active !== undefined) {
          query += ` AND is_active = $${paramIndex}`
          params.push(input.is_active)
          paramIndex++
        }

        query += ` ORDER BY role_name, capability, version DESC`

        const result = await db.query<CompanyPromptTemplate>(query, params)

        return {
          items: result.rows,
          total: result.rows.length
        }
      }),

    /**
     * Get specific company prompt template by ID
     */
    get: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const result = await db.query<CompanyPromptTemplate>(
          `SELECT * FROM company_prompt_templates WHERE id = $1`,
          [input.id]
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Company prompt template ${input.id} not found`
          })
        }

        return result.rows[0]
      }),

    /**
     * List all versions of a specific prompt
     */
    listVersions: publicProcedure
      .input(
        z.object({
          company_id: z.string().uuid(),
          role_name: z.string(),
          capability: z.string()
        })
      )
      .query(async ({ input }) => {
        const result = await db.query<CompanyPromptTemplate>(
          `SELECT * FROM company_prompt_templates
           WHERE company_id = $1 AND role_name = $2 AND capability = $3
           ORDER BY version DESC`,
          [input.company_id, input.role_name, input.capability]
        )

        return {
          items: result.rows,
          total: result.rows.length
        }
      }),

    /**
     * Create new company prompt template
     */
    create: ceoProcedure
      .input(CreateCompanyPromptTemplateSchema)
      .mutation(async ({ input, ctx }) => {
        // Check for duplicate version
        const existing = await db.query(
          `SELECT id FROM company_prompt_templates
           WHERE company_id = $1 AND role_name = $2 AND capability = $3 AND version = $4`,
          [input.company_id, input.role_name, input.capability, input.version]
        )

        if (existing.rows.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Version ${input.version} already exists for ${input.role_name}/${input.capability}`
          })
        }

        const result = await db.query<CompanyPromptTemplate>(
          `INSERT INTO company_prompt_templates (
            company_id, role_name, capability, version, template,
            examples, default_variables, description, changelog, created_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            input.company_id,
            input.role_name,
            input.capability,
            input.version,
            input.template,
            JSON.stringify(input.examples || []),
            JSON.stringify(input.default_variables || {}),
            input.description || null,
            input.changelog || null,
            ctx.user.id
          ]
        )

        console.log(
          `[PromptRouter] Company prompt created: ${input.role_name}/${input.capability} v${input.version}`
        )

        return result.rows[0]
      }),

    /**
     * Activate a specific version (deactivates others for same role/capability)
     */
    activate: ceoProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        // Get the prompt to activate
        const prompt = await db.query<CompanyPromptTemplate>(
          `SELECT * FROM company_prompt_templates WHERE id = $1`,
          [input.id]
        )

        if (prompt.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Company prompt template ${input.id} not found`
          })
        }

        const { company_id, role_name, capability } = prompt.rows[0]

        // Deactivate all other versions
        await db.query(
          `UPDATE company_prompt_templates
           SET is_active = FALSE
           WHERE company_id = $1 AND role_name = $2 AND capability = $3`,
          [company_id, role_name, capability]
        )

        // Activate this version
        const result = await db.query<CompanyPromptTemplate>(
          `UPDATE company_prompt_templates
           SET is_active = TRUE, approved_by_user_id = $2, approved_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [input.id, ctx.user.id]
        )

        console.log(
          `[PromptRouter] Company prompt activated: ${role_name}/${capability} v${prompt.rows[0].version}`
        )

        return result.rows[0]
      }),

    /**
     * Deprecate a prompt version
     */
    deprecate: ceoProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          reason: z.string()
        })
      )
      .mutation(async ({ input }) => {
        const result = await db.query<CompanyPromptTemplate>(
          `UPDATE company_prompt_templates
           SET is_deprecated = TRUE, deprecation_reason = $2, is_active = FALSE
           WHERE id = $1
           RETURNING *`,
          [input.id, input.reason]
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Company prompt template ${input.id} not found`
          })
        }

        console.log(`[PromptRouter] Company prompt deprecated: ${input.id}`)

        return result.rows[0]
      })
  }),

  // ============================================================================
  // Website Prompt Templates (Level 2 - Brand Override)
  // ============================================================================

  website: router({
    /**
     * List website prompt templates
     */
    list: publicProcedure
      .input(
        z.object({
          website_id: z.string().uuid(),
          is_active: z.boolean().optional()
        })
      )
      .query(async ({ input }) => {
        let query = `
          SELECT wpt.*, cpt.role_name, cpt.capability
          FROM website_prompt_templates wpt
          JOIN company_prompt_templates cpt ON wpt.company_prompt_template_id = cpt.id
          WHERE wpt.website_id = $1
        `
        const params: any[] = [input.website_id]

        if (input.is_active !== undefined) {
          query += ` AND wpt.is_active = $2`
          params.push(input.is_active)
        }

        query += ` ORDER BY cpt.role_name, cpt.capability, wpt.version DESC`

        const result = await db.query(query, params)

        return {
          items: result.rows,
          total: result.rows.length
        }
      }),

    /**
     * Get specific website prompt template
     */
    get: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const result = await db.query<WebsitePromptTemplate>(
          `SELECT * FROM website_prompt_templates WHERE id = $1`,
          [input.id]
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Website prompt template ${input.id} not found`
          })
        }

        return result.rows[0]
      }),

    /**
     * Create website prompt override
     */
    create: ceoProcedure
      .input(CreateWebsitePromptTemplateSchema)
      .mutation(async ({ input, ctx }) => {
        // Check for duplicate version
        const existing = await db.query(
          `SELECT id FROM website_prompt_templates
           WHERE website_id = $1 AND company_prompt_template_id = $2 AND version = $3`,
          [input.website_id, input.company_prompt_template_id, input.version]
        )

        if (existing.rows.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Version ${input.version} already exists for this website prompt`
          })
        }

        const result = await db.query<WebsitePromptTemplate>(
          `INSERT INTO website_prompt_templates (
            website_id, company_prompt_template_id, version,
            template_override, template_additions, examples_override,
            variables_override, description, changelog, created_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            input.website_id,
            input.company_prompt_template_id,
            input.version,
            input.template_override || null,
            input.template_additions || null,
            JSON.stringify(input.examples_override || []),
            JSON.stringify(input.variables_override || {}),
            input.description || null,
            input.changelog || null,
            ctx.user.id
          ]
        )

        console.log(`[PromptRouter] Website prompt created: ${result.rows[0].id}`)

        return result.rows[0]
      }),

    /**
     * Activate website prompt version
     */
    activate: ceoProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const prompt = await db.query<WebsitePromptTemplate>(
          `SELECT * FROM website_prompt_templates WHERE id = $1`,
          [input.id]
        )

        if (prompt.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Website prompt template ${input.id} not found`
          })
        }

        const { website_id, company_prompt_template_id } = prompt.rows[0]

        // Deactivate other versions
        await db.query(
          `UPDATE website_prompt_templates
           SET is_active = FALSE
           WHERE website_id = $1 AND company_prompt_template_id = $2`,
          [website_id, company_prompt_template_id]
        )

        // Activate this version
        const result = await db.query<WebsitePromptTemplate>(
          `UPDATE website_prompt_templates
           SET is_active = TRUE, approved_by_user_id = $2, approved_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [input.id, ctx.user.id]
        )

        console.log(`[PromptRouter] Website prompt activated: ${input.id}`)

        return result.rows[0]
      })
  }),

  // ============================================================================
  // Agent Prompt Bindings (Level 3 - Individual Agent)
  // ============================================================================

  binding: router({
    /**
     * List bindings for an agent
     */
    list: publicProcedure
      .input(z.object({ agent_id: z.string().uuid() }))
      .query(async ({ input }) => {
        const result = await db.query<AgentPromptBinding>(
          `SELECT * FROM agent_prompt_bindings
           WHERE agent_id = $1
           ORDER BY capability`,
          [input.agent_id]
        )

        return {
          items: result.rows,
          total: result.rows.length
        }
      }),

    /**
     * Get specific binding
     */
    get: publicProcedure
      .input(
        z.object({
          agent_id: z.string().uuid(),
          capability: z.string()
        })
      )
      .query(async ({ input }) => {
        const result = await db.query<AgentPromptBinding>(
          `SELECT * FROM agent_prompt_bindings
           WHERE agent_id = $1 AND capability = $2`,
          [input.agent_id, input.capability]
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `No binding found for agent ${input.agent_id}, capability ${input.capability}`
          })
        }

        return result.rows[0]
      }),

    /**
     * Create agent prompt binding
     */
    create: ceoProcedure
      .input(CreateAgentPromptBindingSchema)
      .mutation(async ({ input }) => {
        // Check for existing binding
        const existing = await db.query(
          `SELECT id FROM agent_prompt_bindings
           WHERE agent_id = $1 AND capability = $2`,
          [input.agent_id, input.capability]
        )

        if (existing.rows.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Binding already exists for capability ${input.capability}`
          })
        }

        const result = await db.query<AgentPromptBinding>(
          `INSERT INTO agent_prompt_bindings (
            agent_id, capability, company_prompt_template_id,
            website_prompt_template_id, custom_variables,
            ab_test_group, ab_test_weight
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *`,
          [
            input.agent_id,
            input.capability,
            input.company_prompt_template_id || null,
            input.website_prompt_template_id || null,
            JSON.stringify(input.custom_variables || {}),
            input.ab_test_group || null,
            input.ab_test_weight || 1.0
          ]
        )

        console.log(
          `[PromptRouter] Binding created: agent ${input.agent_id}, capability ${input.capability}`
        )

        return result.rows[0]
      }),

    /**
     * Update binding (change custom variables or A/B test settings)
     */
    update: ceoProcedure
      .input(
        z.object({
          agent_id: z.string().uuid(),
          capability: z.string(),
          custom_variables: z.record(z.any()).optional(),
          ab_test_group: z.string().optional(),
          ab_test_weight: z.number().min(0).max(1).optional(),
          is_active: z.boolean().optional()
        })
      )
      .mutation(async ({ input }) => {
        const { agent_id, capability, ...updates } = input

        const setClauses: string[] = []
        const params: any[] = []
        let paramIndex = 1

        if (updates.custom_variables !== undefined) {
          setClauses.push(`custom_variables = $${paramIndex}`)
          params.push(JSON.stringify(updates.custom_variables))
          paramIndex++
        }

        if (updates.ab_test_group !== undefined) {
          setClauses.push(`ab_test_group = $${paramIndex}`)
          params.push(updates.ab_test_group)
          paramIndex++
        }

        if (updates.ab_test_weight !== undefined) {
          setClauses.push(`ab_test_weight = $${paramIndex}`)
          params.push(updates.ab_test_weight)
          paramIndex++
        }

        if (updates.is_active !== undefined) {
          setClauses.push(`is_active = $${paramIndex}`)
          params.push(updates.is_active)
          paramIndex++
        }

        if (setClauses.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No fields to update'
          })
        }

        setClauses.push(`updated_at = NOW()`)
        params.push(agent_id, capability)

        const result = await db.query<AgentPromptBinding>(
          `UPDATE agent_prompt_bindings
           SET ${setClauses.join(', ')}
           WHERE agent_id = $${paramIndex} AND capability = $${paramIndex + 1}
           RETURNING *`,
          params
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Binding not found`
          })
        }

        console.log(`[PromptRouter] Binding updated: agent ${agent_id}, capability ${capability}`)

        return result.rows[0]
      }),

    /**
     * Delete binding
     */
    delete: ceoProcedure
      .input(
        z.object({
          agent_id: z.string().uuid(),
          capability: z.string()
        })
      )
      .mutation(async ({ input }) => {
        const result = await db.query(
          `DELETE FROM agent_prompt_bindings
           WHERE agent_id = $1 AND capability = $2
           RETURNING id`,
          [input.agent_id, input.capability]
        )

        if (result.rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Binding not found`
          })
        }

        console.log(
          `[PromptRouter] Binding deleted: agent ${input.agent_id}, capability ${input.capability}`
        )

        return { success: true }
      })
  }),

  // ============================================================================
  // Prompt Resolution & Rendering
  // ============================================================================

  /**
   * Resolve prompt for an agent (returns ResolvedPrompt with metadata)
   */
  resolve: publicProcedure
    .input(
      z.object({
        agent_id: z.string().uuid(),
        capability: z.string(),
        runtime_variables: z.record(z.any()).optional()
      })
    )
    .query(async ({ input }) => {
      try {
        const resolved = await resolvePrompt(input)
        return resolved
      } catch (error: any) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error.message
        })
      }
    }),

  /**
   * Render prompt (resolve + variable substitution)
   */
  render: publicProcedure
    .input(
      z.object({
        agent_id: z.string().uuid(),
        capability: z.string(),
        runtime_variables: z.record(z.any()).optional()
      })
    )
    .query(async ({ input }) => {
      try {
        const { prompt, resolved } = await resolveAndRender(input)
        return {
          prompt,
          metadata: {
            resolution_path: resolved.resolution_path,
            company_version: resolved.company_version,
            website_version: resolved.website_version,
            examples_count: resolved.examples.length
          }
        }
      } catch (error: any) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error.message
        })
      }
    }),

  // ============================================================================
  // Execution Logging
  // ============================================================================

  /**
   * Log prompt execution (for performance tracking)
   */
  logExecution: protectedProcedure
    .input(CreatePromptExecutionSchema)
    .mutation(async ({ input }) => {
      try {
        // First resolve the prompt to get metadata
        const resolved = await resolvePrompt({
          agent_id: input.agent_id,
          capability: input.capability,
          runtime_variables: input.input_variables
        })

        const executionId = await logExecution({
          ...input,
          resolved
        })

        return { id: executionId }
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to log execution: ${error.message}`
        })
      }
    }),

  /**
   * Rate execution quality
   */
  rateExecution: protectedProcedure
    .input(
      z.object({
        execution_id: z.string().uuid(),
        quality_score: z.number().min(0).max(5),
        rated_by: z.string(),
        feedback: z.string().optional()
      })
    )
    .mutation(async ({ input }) => {
      await rateExecution(
        input.execution_id,
        input.quality_score,
        input.rated_by,
        input.feedback
      )

      console.log(`[PromptRouter] Execution rated: ${input.execution_id} - ${input.quality_score}/5`)

      return { success: true }
    }),

  /**
   * Get execution history for an agent/capability
   */
  getExecutionHistory: publicProcedure
    .input(
      z.object({
        agent_id: z.string().uuid().optional(),
        capability: z.string().optional(),
        limit: z.number().min(1).max(100).default(20)
      })
    )
    .query(async ({ input }) => {
      let query = `SELECT * FROM prompt_executions WHERE 1=1`
      const params: any[] = []
      let paramIndex = 1

      if (input.agent_id) {
        query += ` AND agent_id = $${paramIndex}`
        params.push(input.agent_id)
        paramIndex++
      }

      if (input.capability) {
        query += ` AND capability = $${paramIndex}`
        params.push(input.capability)
        paramIndex++
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`
      params.push(input.limit)

      const result = await db.query<PromptExecution>(query, params)

      return {
        items: result.rows,
        total: result.rows.length
      }
    }),

  // ============================================================================
  // Analytics
  // ============================================================================

  /**
   * Get performance metrics for a prompt
   */
  getPerformanceMetrics: publicProcedure
    .input(
      z.object({
        company_prompt_id: z.string().uuid().optional(),
        website_prompt_id: z.string().uuid().optional(),
        agent_id: z.string().uuid().optional(),
        capability: z.string().optional(),
        days: z.number().min(1).max(90).default(30)
      })
    )
    .query(async ({ input }) => {
      let whereClause = `WHERE created_at >= NOW() - INTERVAL '${input.days} days'`
      const params: any[] = []
      let paramIndex = 1

      if (input.company_prompt_id) {
        whereClause += ` AND company_prompt_template_id = $${paramIndex}`
        params.push(input.company_prompt_id)
        paramIndex++
      }

      if (input.website_prompt_id) {
        whereClause += ` AND website_prompt_template_id = $${paramIndex}`
        params.push(input.website_prompt_id)
        paramIndex++
      }

      if (input.agent_id) {
        whereClause += ` AND agent_id = $${paramIndex}`
        params.push(input.agent_id)
        paramIndex++
      }

      if (input.capability) {
        whereClause += ` AND capability = $${paramIndex}`
        params.push(input.capability)
        paramIndex++
      }

      const result = await db.query(
        `SELECT
          COUNT(*) as total_executions,
          COUNT(*) FILTER (WHERE error_occurred = FALSE) as successful_executions,
          COUNT(*) FILTER (WHERE error_occurred = TRUE) as failed_executions,
          AVG(quality_score) as avg_quality_score,
          STDDEV(quality_score) as quality_stddev,
          COUNT(*) FILTER (WHERE quality_score >= 4.0) as high_quality_count,
          COUNT(*) FILTER (WHERE quality_score < 3.0) as low_quality_count,
          AVG(tokens_used) as avg_tokens,
          AVG(latency_ms) as avg_latency_ms,
          AVG(revision_count) as avg_revisions,
          MIN(created_at) as first_execution,
          MAX(created_at) as last_execution
        FROM prompt_executions
        ${whereClause}`,
        params
      )

      return result.rows[0]
    })
})
