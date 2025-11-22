/**
 * Task API Router
 * Endpoints for managing agent tasks
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from '../trpc'
import { taskRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import { events } from '@swarm-press/event-bus'

export const taskRouter = router({
  /**
   * Get all tasks with optional filtering
   */
  list: publicProcedure
    .input(
      z.object({
        status: z.enum(['planned', 'in_progress', 'completed', 'failed', 'cancelled']).optional(),
        agentId: z.string().optional(),
        contentId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { status, agentId, contentId, limit, offset } = input

      const tasks = await taskRepository.findAll({
        status,
        agent_id: agentId,
        content_id: contentId,
        limit,
        offset,
      })

      return {
        items: tasks,
        total: tasks.length,
        limit,
        offset,
      }
    }),

  /**
   * Get task by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const task = await taskRepository.findById(input.id)

      if (!task) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Task ${input.id} not found`,
        })
      }

      return task
    }),

  /**
   * Create new task
   */
  create: protectedProcedure
    .input(
      z.object({
        type: z.string(),
        title: z.string().min(1),
        description: z.string().min(1),
        agentId: z.string(),
        contentId: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const task = await taskRepository.create({
        type: input.type,
        title: input.title,
        description: input.description,
        agent_id: input.agentId,
        content_id: input.contentId,
        status: 'planned',
        priority: input.priority,
        metadata: input.metadata || {},
      })

      // Publish task created event
      await events.taskCreated(task.id, task.agent_id, task.type)

      console.log(`[TaskRouter] Task created: ${task.id} by ${ctx.user.email}`)

      return task
    }),

  /**
   * Update task
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input

      const existing = await taskRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Task ${id} not found`,
        })
      }

      const updated = await taskRepository.update(id, updates)

      console.log(`[TaskRouter] Task updated: ${id} by ${ctx.user.email}`)

      return updated
    }),

  /**
   * Transition task state
   */
  transition: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        event: z.string(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await taskRepository.transition(
        input.id,
        input.event,
        ctx.user.role === 'ceo' ? 'CEO' : 'System',
        ctx.user.id,
        input.metadata
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'State transition failed',
        })
      }

      console.log(
        `[TaskRouter] Task ${input.id} transitioned via ${input.event} by ${ctx.user.email}`
      )

      return result
    }),

  /**
   * Mark task as completed
   */
  complete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        result: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const task = await taskRepository.findById(input.id)
      if (!task) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Task ${input.id} not found`,
        })
      }

      const result = await taskRepository.transition(
        input.id,
        'complete',
        'System',
        ctx.user.id,
        { result: input.result }
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Task completion failed',
        })
      }

      // Publish task completed event
      await events.taskCompleted(input.id, ctx.user.id)

      console.log(`[TaskRouter] Task ${input.id} completed`)

      return result
    }),

  /**
   * Mark task as failed
   */
  fail: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        error: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await taskRepository.transition(
        input.id,
        'fail',
        'System',
        ctx.user.id,
        { error: input.error }
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Task failure transition failed',
        })
      }

      console.log(`[TaskRouter] Task ${input.id} marked as failed`)

      return result
    }),

  /**
   * Get task state history
   */
  getHistory: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const history = await taskRepository.getStateHistory(input.id)
      return history
    }),
})
