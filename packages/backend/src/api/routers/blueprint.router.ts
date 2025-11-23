/**
 * Blueprint Router
 * Handles CRUD operations for page blueprints/templates
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { blueprintRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import type { CreateBlueprintInput, UpdateBlueprintInput } from '@swarm-press/shared'

export const blueprintRouter = router({
  /**
   * List all blueprints
   */
  list: publicProcedure
    .query(async () => {
      const blueprints = await blueprintRepository.findAll()
      return { items: blueprints }
    }),

  /**
   * List all blueprints ordered by name
   */
  listOrdered: publicProcedure
    .query(async () => {
      const blueprints = await blueprintRepository.findAllOrdered()
      return { items: blueprints }
    }),

  /**
   * Get blueprint by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const blueprint = await blueprintRepository.findById(input.id)
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Blueprint with id ${input.id} not found`
        })
      }
      return blueprint
    }),

  /**
   * Get blueprint by page_type
   */
  getByPageType: publicProcedure
    .input(z.object({ pageType: z.string() }))
    .query(async ({ input }) => {
      const blueprint = await blueprintRepository.findByPageType(input.pageType)
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Blueprint for page_type "${input.pageType}" not found`
        })
      }
      return blueprint
    }),

  /**
   * Create a new blueprint
   */
  create: publicProcedure
    .input(z.object({
      page_type: z.string(),
      name: z.string(),
      description: z.string().optional(),
      components: z.array(z.object({
        type: z.string(),
        order: z.number(),
        required: z.boolean().optional(),
        required_fields: z.array(z.string()).optional(),
        config: z.any().optional()
      })),
      global_linking_rules: z.object({
        min_total_links: z.number().optional(),
        max_total_links: z.number().optional(),
        prefer_newer: z.boolean().optional(),
        prefer_higher_authority: z.boolean().optional()
      }).optional(),
      seo_template: z.object({
        title_pattern: z.string().optional(),
        meta_description_pattern: z.string().optional(),
        required_keywords: z.array(z.string()).optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const blueprint = await blueprintRepository.createBlueprint(input as CreateBlueprintInput)
        return blueprint
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create blueprint'
        })
      }
    }),

  /**
   * Update a blueprint
   */
  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      page_type: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      components: z.array(z.object({
        type: z.string(),
        order: z.number(),
        required: z.boolean().optional(),
        required_fields: z.array(z.string()).optional(),
        config: z.any().optional()
      })).optional(),
      global_linking_rules: z.object({
        min_total_links: z.number().optional(),
        max_total_links: z.number().optional(),
        prefer_newer: z.boolean().optional(),
        prefer_higher_authority: z.boolean().optional()
      }).optional(),
      seo_template: z.object({
        title_pattern: z.string().optional(),
        meta_description_pattern: z.string().optional(),
        required_keywords: z.array(z.string()).optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      const blueprint = await blueprintRepository.updateBlueprint(id, updates as UpdateBlueprintInput)
      if (!blueprint) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update blueprint'
        })
      }
      return blueprint
    }),

  /**
   * Validate a page against its blueprint
   */
  validatePage: publicProcedure
    .input(z.object({
      blueprintId: z.string().uuid(),
      pageData: z.any()
    }))
    .query(async ({ input }) => {
      const validation = await blueprintRepository.validatePage(
        input.pageData,
        input.blueprintId
      )
      return validation
    }),

  /**
   * Delete a blueprint
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const deleted = await blueprintRepository.delete(input.id)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Blueprint with id ${input.id} not found`
        })
      }
      return { success: true }
    })
})
