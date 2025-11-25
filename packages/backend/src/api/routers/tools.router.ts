/**
 * Tools API Router
 * Endpoints for managing external tool configurations
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import {
  toolConfigRepository,
  websiteToolRepository,
  toolSecretRepository,
} from '../../db/repositories'
import {
  CreateToolConfigSchema,
  ToolTypeSchema,
  CreateJavaScriptToolSchema,
  UpdateJavaScriptToolSchema,
  TestJavaScriptToolSchema,
  type JavaScriptManifest,
} from '@swarm-press/shared'
import { TRPCError } from '@trpc/server'

/**
 * Convert a JavaScript manifest to JSON Schema format for agent consumption
 */
function manifestToInputSchema(manifest: JavaScriptManifest['input']): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, field] of Object.entries(manifest)) {
    properties[key] = {
      type: field.type,
      ...(field.description && { description: field.description }),
    }
    if (field.required) {
      required.push(key)
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }
}

export const toolsRouter = router({
  // ==========================================================================
  // Tool Configs
  // ==========================================================================

  /**
   * List all tool configurations
   */
  list: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
          type: ToolTypeSchema.optional(),
        })
        .optional()
        .default({ limit: 50, offset: 0 })
    )
    .query(async ({ input }) => {
      let tools = await toolConfigRepository.findAll({
        limit: input.limit,
        offset: input.offset,
      })

      // Filter by type if specified
      if (input.type) {
        tools = tools.filter((t) => t.type === input.type)
      }

      return {
        items: tools,
        total: tools.length,
        limit: input.limit,
        offset: input.offset,
      }
    }),

  /**
   * Get tool config by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const tool = await toolConfigRepository.findById(input.id)

      if (!tool) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool config ${input.id} not found`,
        })
      }

      return tool
    }),

  /**
   * Get tool config by name
   */
  getByName: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }) => {
      const tool = await toolConfigRepository.findByName(input.name)

      if (!tool) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool config "${input.name}" not found`,
        })
      }

      return tool
    }),

  /**
   * Create a new tool configuration
   */
  create: ceoProcedure
    .input(CreateToolConfigSchema)
    .mutation(async ({ input }) => {
      // Check if name already exists
      const exists = await toolConfigRepository.nameExists(input.name)
      if (exists) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Tool with name "${input.name}" already exists`,
        })
      }

      const tool = await toolConfigRepository.create(input)
      console.log(`[ToolsRouter] Tool config created: ${tool.id} (${tool.name})`)

      return tool
    }),

  /**
   * Update a tool configuration
   */
  update: ceoProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: CreateToolConfigSchema.partial(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if name already exists (if changing name)
      if (input.data.name) {
        const exists = await toolConfigRepository.nameExists(input.data.name, input.id)
        if (exists) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Tool with name "${input.data.name}" already exists`,
          })
        }
      }

      const tool = await toolConfigRepository.update(input.id, input.data)

      if (!tool) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool config ${input.id} not found`,
        })
      }

      console.log(`[ToolsRouter] Tool config updated: ${tool.id}`)
      return tool
    }),

  /**
   * Delete a tool configuration
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const deleted = await toolConfigRepository.delete(input.id)

      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool config ${input.id} not found`,
        })
      }

      console.log(`[ToolsRouter] Tool config deleted: ${input.id}`)
      return { success: true }
    }),

  // ==========================================================================
  // Website Tool Assignments
  // ==========================================================================

  /**
   * Get all tools for a website (including global tools)
   */
  getForWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const tools = await websiteToolRepository.findForWebsite(input.websiteId)
      return {
        items: tools,
        total: tools.length,
      }
    }),

  /**
   * Get global tools only
   */
  getGlobal: publicProcedure.query(async () => {
    const tools = await websiteToolRepository.findGlobal()
    return {
      items: tools,
      total: tools.length,
    }
  }),

  /**
   * Add a tool to a website (or make it global with null websiteId)
   */
  addToWebsite: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid().nullable(),
        toolConfigId: z.string().uuid(),
        enabled: z.boolean().optional(),
        priority: z.number().int().optional(),
        customConfig: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await websiteToolRepository.addToWebsite({
        website_id: input.websiteId,
        tool_config_id: input.toolConfigId,
        enabled: input.enabled,
        priority: input.priority,
        custom_config: input.customConfig,
      })

      console.log(
        `[ToolsRouter] Tool ${input.toolConfigId} added to ${input.websiteId || 'global'}`
      )
      return result
    }),

  /**
   * Remove a tool from a website
   */
  removeFromWebsite: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid().nullable(),
        toolConfigId: z.string().uuid(),
      })
    )
    .mutation(async ({ input }) => {
      const removed = await websiteToolRepository.removeFromWebsite(
        input.websiteId,
        input.toolConfigId
      )

      if (!removed) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool assignment not found`,
        })
      }

      console.log(
        `[ToolsRouter] Tool ${input.toolConfigId} removed from ${input.websiteId || 'global'}`
      )
      return { success: true }
    }),

  /**
   * Get all website assignments for a specific tool
   */
  getAssignmentsForTool: publicProcedure
    .input(z.object({ toolConfigId: z.string().uuid() }))
    .query(async ({ input }) => {
      const assignments = await websiteToolRepository.findForTool(input.toolConfigId)
      return {
        items: assignments,
        total: assignments.length,
      }
    }),

  /**
   * Enable or disable a tool for a website
   */
  setEnabled: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid().nullable(),
        toolConfigId: z.string().uuid(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const updated = await websiteToolRepository.setEnabled(
        input.websiteId,
        input.toolConfigId,
        input.enabled
      )

      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool assignment not found`,
        })
      }

      return { success: true, enabled: input.enabled }
    }),

  // ==========================================================================
  // Tool Secrets
  // ==========================================================================

  /**
   * List secret keys for a tool on a website (without values)
   */
  listSecrets: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        toolConfigId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      const secrets = await toolSecretRepository.getSecretKeysForTool(
        input.websiteId,
        input.toolConfigId
      )
      return {
        items: secrets,
        total: secrets.length,
      }
    }),

  /**
   * Set a secret for a tool on a website
   */
  setSecret: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        toolConfigId: z.string().uuid(),
        secretKey: z.string().min(1).max(100),
        value: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await toolSecretRepository.setSecret({
        website_id: input.websiteId,
        tool_config_id: input.toolConfigId,
        secret_key: input.secretKey,
        value: input.value,
      })

      console.log(
        `[ToolsRouter] Secret "${input.secretKey}" set for tool ${input.toolConfigId} on website ${input.websiteId}`
      )
      return { success: true }
    }),

  /**
   * Delete a secret
   */
  deleteSecret: ceoProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        toolConfigId: z.string().uuid(),
        secretKey: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const deleted = await toolSecretRepository.deleteSecret(
        input.websiteId,
        input.toolConfigId,
        input.secretKey
      )

      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Secret "${input.secretKey}" not found`,
        })
      }

      return { success: true }
    }),

  // ==========================================================================
  // JavaScript Tool Management
  // ==========================================================================

  /**
   * Create a new JavaScript tool
   * This creates a tool_config with type='javascript' and assigns it to a website
   */
  createJavaScriptTool: ceoProcedure
    .input(CreateJavaScriptToolSchema)
    .mutation(async ({ input }) => {
      // Check if name already exists
      const exists = await toolConfigRepository.nameExists(input.name)
      if (exists) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Tool with name "${input.name}" already exists`,
        })
      }

      // Create tool config with JavaScript type
      const toolConfig = await toolConfigRepository.create({
        name: input.name,
        display_name: input.display_name,
        description: input.description,
        type: 'javascript',
        config: {
          code: input.code,
          manifest: input.manifest,
          timeout: input.timeout || 5000,
          allowAsync: true,
        },
        input_schema: manifestToInputSchema(input.manifest.input),
      })

      // Assign to website (or global if website_id is null)
      await websiteToolRepository.addToWebsite({
        website_id: input.website_id ?? null,
        tool_config_id: toolConfig.id,
        enabled: true,
        priority: 0,
      })

      console.log(
        `[ToolsRouter] JavaScript tool created: ${toolConfig.id} (${toolConfig.name}) for ${input.website_id || 'global'}`
      )

      return toolConfig
    }),

  /**
   * Update a JavaScript tool's code or manifest
   */
  updateJavaScriptTool: ceoProcedure
    .input(
      z.object({
        toolId: z.string().uuid(),
        ...UpdateJavaScriptToolSchema.shape,
      })
    )
    .mutation(async ({ input }) => {
      const existing = await toolConfigRepository.findById(input.toolId)

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool ${input.toolId} not found`,
        })
      }

      if (existing.type !== 'javascript') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Tool ${input.toolId} is not a JavaScript tool`,
        })
      }

      const currentConfig = existing.config as Record<string, unknown>
      const newConfig = {
        ...currentConfig,
        ...(input.code && { code: input.code }),
        ...(input.manifest && { manifest: input.manifest }),
        ...(input.timeout && { timeout: input.timeout }),
      }

      const updated = await toolConfigRepository.update(input.toolId, {
        config: newConfig,
        input_schema: input.manifest
          ? manifestToInputSchema(input.manifest.input)
          : existing.input_schema ?? undefined,
      })

      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool ${input.toolId} not found`,
        })
      }

      console.log(`[ToolsRouter] JavaScript tool updated: ${input.toolId}`)
      return updated
    }),

  /**
   * Test a JavaScript tool with sample input (dry run)
   * This executes the tool in a sandbox and returns the result
   */
  testJavaScriptTool: ceoProcedure
    .input(TestJavaScriptToolSchema)
    .mutation(async ({ input }) => {
      const tool = await toolConfigRepository.findById(input.tool_id)

      if (!tool) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Tool ${input.tool_id} not found`,
        })
      }

      if (tool.type !== 'javascript') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Tool ${input.tool_id} is not a JavaScript tool`,
        })
      }

      // Get secrets for this tool
      const secrets = await toolSecretRepository.getSecretsForTool(
        input.website_id,
        input.tool_id
      )

      // Dynamically import the JavaScript adapter to avoid circular dependencies
      // and keep the backend package lightweight
      try {
        const { JavaScriptToolAdapter } = await import('@swarm-press/agents')

        const adapter = new JavaScriptToolAdapter()
        await adapter.initialize(tool, secrets)

        const result = await adapter.execute(input.test_input)
        await adapter.dispose()

        console.log(
          `[ToolsRouter] JavaScript tool tested: ${input.tool_id} - ${result.success ? 'success' : 'failed'}`
        )

        return result
      } catch (error) {
        console.error(`[ToolsRouter] JavaScript tool test failed:`, error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to test JavaScript tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),

  /**
   * List all JavaScript tools
   */
  listJavaScriptTools: publicProcedure
    .input(
      z
        .object({
          websiteId: z.string().uuid().optional(),
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
        })
        .optional()
        .default({ limit: 50, offset: 0 })
    )
    .query(async ({ input }) => {
      const tools = await toolConfigRepository.findByType('javascript')

      // If websiteId specified, filter to only tools assigned to that website
      if (input.websiteId) {
        const websiteTools = await websiteToolRepository.findForWebsite(input.websiteId)
        const assignedIds = new Set(websiteTools.map((wt) => wt.tool_config_id))
        const filtered = tools.filter((t) => assignedIds.has(t.id))
        return {
          items: filtered.slice(input.offset, input.offset + input.limit),
          total: filtered.length,
          limit: input.limit,
          offset: input.offset,
        }
      }

      return {
        items: tools.slice(input.offset, input.offset + input.limit),
        total: tools.length,
        limit: input.limit,
        offset: input.offset,
      }
    }),
})
