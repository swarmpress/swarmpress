/**
 * Agent API Router
 * Endpoints for managing AI agents
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { agentRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

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
        capabilities: z.array(z.string()).optional(),
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
        capabilities: input.capabilities || [],
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
        capabilities: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, roleId, departmentId, virtualEmail, ...updates } = input

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

      const updateData = {
        ...updates,
        ...(roleId && { role_id: roleId }),
        ...(departmentId && { department_id: departmentId }),
        ...(virtualEmail && { virtual_email: virtualEmail }),
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
