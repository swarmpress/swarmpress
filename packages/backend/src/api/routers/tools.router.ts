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
import { CreateToolConfigSchema, ToolTypeSchema } from '@swarm-press/shared'
import { TRPCError } from '@trpc/server'

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
})
