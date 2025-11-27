/**
 * Agent API Router
 * Endpoints for managing AI agents
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { agentRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

// Writing style schema for validation
const WritingStyleInputSchema = z.object({
  tone: z.enum([
    'professional', 'casual', 'friendly', 'authoritative',
    'conversational', 'enthusiastic', 'formal', 'playful'
  ]).optional(),
  vocabulary_level: z.enum(['simple', 'moderate', 'advanced', 'technical']).optional(),
  sentence_length: z.enum(['short', 'medium', 'long', 'varied']).optional(),
  formality: z.enum(['very_informal', 'informal', 'neutral', 'formal', 'very_formal']).optional(),
  humor: z.enum(['none', 'subtle', 'moderate', 'frequent']).optional(),
  emoji_usage: z.enum(['never', 'rarely', 'sometimes', 'often']).optional(),
  perspective: z.enum(['first_person', 'second_person', 'third_person']).optional(),
  descriptive_style: z.enum(['factual', 'evocative', 'poetic', 'practical']).optional(),
}).optional()

// Model config schema
const ModelConfigInputSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
}).optional()

// Capability schema (supports both string and typed object)
const CapabilityInputSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
  })
])

export const agentRouter = router({
  /**
   * Get all agents, optionally filtered by role or department
   */
  list: publicProcedure
    .input(
      z.object({
        roleId: z.string().uuid().optional(),
        departmentId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      let agents
      if (input.roleId) {
        agents = await agentRepository.findByRole(input.roleId)
      } else if (input.departmentId) {
        agents = await agentRepository.findByDepartment(input.departmentId)
      } else {
        agents = await agentRepository.findAll()
      }

      return {
        items: agents,
        total: agents.length,
      }
    }),

  /**
   * Get agent by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const agent = await agentRepository.findById(input.id)

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent ${input.id} not found`,
        })
      }

      return agent
    }),

  /**
   * Get agent by email
   */
  getByEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const agent = await agentRepository.findByEmail(input.email)

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent with email ${input.email} not found`,
        })
      }

      return agent
    }),

  /**
   * Create new agent
   */
  create: ceoProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        roleId: z.string().uuid(),
        departmentId: z.string().uuid(),
        persona: z.string(),
        virtualEmail: z.string().email(),
        description: z.string().optional(),
        // Visual identity
        avatarUrl: z.string().url().optional(),
        profileImageUrl: z.string().url().optional(),
        // Personality & style
        hobbies: z.array(z.string()).optional(),
        writingStyle: WritingStyleInputSchema,
        // Capabilities
        capabilities: z.array(CapabilityInputSchema).optional(),
        // Model config
        modelConfig: ModelConfigInputSchema,
      })
    )
    .mutation(async ({ input }) => {
      // Check if agent with same email exists
      const existing = await agentRepository.findByEmail(input.virtualEmail)
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent with email "${input.virtualEmail}" already exists`,
        })
      }

      const agent = await agentRepository.create({
        name: input.name,
        role_id: input.roleId,
        department_id: input.departmentId,
        persona: input.persona,
        virtual_email: input.virtualEmail,
        description: input.description,
        avatar_url: input.avatarUrl,
        profile_image_url: input.profileImageUrl,
        hobbies: input.hobbies,
        writing_style: input.writingStyle,
        capabilities: input.capabilities || [],
        model_config: input.modelConfig,
      })

      console.log(`[AgentRouter] Agent created: ${agent.id} - ${agent.name}`)

      return agent
    }),

  /**
   * Update agent
   */
  update: ceoProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        roleId: z.string().uuid().optional(),
        departmentId: z.string().uuid().optional(),
        persona: z.string().optional(),
        virtualEmail: z.string().email().optional(),
        description: z.string().optional(),
        // Visual identity
        avatarUrl: z.string().url().optional().nullable(),
        profileImageUrl: z.string().url().optional().nullable(),
        // Personality & style
        hobbies: z.array(z.string()).optional().nullable(),
        writingStyle: WritingStyleInputSchema.nullable(),
        // Capabilities
        capabilities: z.array(CapabilityInputSchema).optional(),
        // Model config
        modelConfig: ModelConfigInputSchema.nullable(),
        // Status
        status: z.enum(['active', 'inactive', 'suspended']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const {
        id,
        roleId,
        departmentId,
        virtualEmail,
        avatarUrl,
        profileImageUrl,
        writingStyle,
        modelConfig,
        ...updates
      } = input

      const existing = await agentRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent ${id} not found`,
        })
      }

      // Check if new email conflicts
      if (virtualEmail && virtualEmail !== existing.virtual_email) {
        const emailConflict = await agentRepository.findByEmail(virtualEmail)
        if (emailConflict) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Agent with email "${virtualEmail}" already exists`,
          })
        }
      }

      const updateData: Record<string, any> = {
        ...updates,
        ...(roleId !== undefined && { role_id: roleId }),
        ...(departmentId !== undefined && { department_id: departmentId }),
        ...(virtualEmail !== undefined && { virtual_email: virtualEmail }),
        ...(avatarUrl !== undefined && { avatar_url: avatarUrl }),
        ...(profileImageUrl !== undefined && { profile_image_url: profileImageUrl }),
        ...(writingStyle !== undefined && { writing_style: writingStyle }),
        ...(modelConfig !== undefined && { model_config: modelConfig }),
      }

      const agent = await agentRepository.update(id, updateData)

      if (!agent) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update agent',
        })
      }

      console.log(`[AgentRouter] Agent updated: ${agent.id}`)

      return agent
    }),

  /**
   * Delete agent
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await agentRepository.findById(input.id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent ${input.id} not found`,
        })
      }

      await agentRepository.delete(input.id)

      console.log(`[AgentRouter] Agent deleted: ${input.id}`)

      return { success: true }
    }),
})
