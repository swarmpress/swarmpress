/**
 * Content Model Router
 * Handles CRUD operations for content models (atomic design system)
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { contentModelRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import type { CreateContentModelInput, UpdateContentModelInput } from '@swarm-press/shared'

export const contentModelRouter = router({
  /**
   * List all content models
   */
  list: publicProcedure
    .query(async () => {
      const models = await contentModelRepository.findAll()
      return { items: models }
    }),

  /**
   * List all models ordered by kind and name
   */
  listOrdered: publicProcedure
    .query(async () => {
      const models = await contentModelRepository.findAllOrdered()
      return { items: models }
    }),

  /**
   * Get content model by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const model = await contentModelRepository.findById(input.id)
      if (!model) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Content model with id ${input.id} not found`
        })
      }
      return model
    }),

  /**
   * Get content model by model_id
   */
  getByModelId: publicProcedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      const model = await contentModelRepository.findByModelId(input.modelId)
      if (!model) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Content model with model_id "${input.modelId}" not found`
        })
      }
      return model
    }),

  /**
   * List models by kind (atom, molecule, organism, template)
   */
  listByKind: publicProcedure
    .input(z.object({
      kind: z.enum(['atom', 'molecule', 'organism', 'template'])
    }))
    .query(async ({ input }) => {
      const models = await contentModelRepository.findByKind(input.kind)
      return { items: models }
    }),

  /**
   * Get relationship graph of all models
   */
  getRelationshipGraph: publicProcedure
    .query(async () => {
      const graph = await contentModelRepository.getRelationshipGraph()
      return graph
    }),

  /**
   * Create a new content model
   */
  create: publicProcedure
    .input(z.object({
      model_id: z.string(),
      name: z.string(),
      kind: z.enum(['atom', 'molecule', 'organism', 'template']),
      description: z.string().optional(),
      version: z.string().optional(),
      fields: z.array(z.object({
        id: z.string(),
        label: z.string(),
        type: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        default: z.any().optional(),
        validations: z.any().optional(),
        ai_hints: z.any().optional()
      })),
      relations: z.array(z.object({
        name: z.string(),
        target_model: z.string(),
        type: z.enum(['has_one', 'has_many', 'belongs_to'])
      })).optional(),
      ai_guidance: z.any().optional(),
      lifecycle: z.any().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const model = await contentModelRepository.createContentModel(input as CreateContentModelInput)
        return model
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create content model'
        })
      }
    }),

  /**
   * Update a content model
   */
  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      version: z.string().optional(),
      fields: z.array(z.object({
        id: z.string(),
        label: z.string(),
        type: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        default: z.any().optional(),
        validations: z.any().optional(),
        ai_hints: z.any().optional()
      })).optional(),
      relations: z.array(z.object({
        name: z.string(),
        target_model: z.string(),
        type: z.enum(['has_one', 'has_many', 'belongs_to'])
      })).optional(),
      ai_guidance: z.any().optional(),
      lifecycle: z.any().optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      const model = await contentModelRepository.updateContentModel(id, updates as UpdateContentModelInput)
      if (!model) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update content model'
        })
      }
      return model
    }),

  /**
   * Delete a content model
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const deleted = await contentModelRepository.delete(input.id)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Content model with id ${input.id} not found`
        })
      }
      return { success: true }
    })
})
