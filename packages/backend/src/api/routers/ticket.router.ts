/**
 * Question Ticket API Router
 * Endpoints for managing CEO question tickets
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure, ceoProcedure } from '../trpc'
import { questionTicketRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import { events } from '@agent-press/event-bus'

export const ticketRouter = router({
  /**
   * Get all question tickets with optional filtering
   */
  list: publicProcedure
    .input(
      z.object({
        status: z.enum(['open', 'answered', 'resolved']).optional(),
        target: z.enum(['ceo', 'writer', 'editor', 'engineering']).optional(),
        contentId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { status, target, contentId, limit, offset } = input

      const tickets = await questionTicketRepository.findAll({
        status,
        target,
        content_id: contentId,
        limit,
        offset,
      })

      return {
        items: tickets,
        total: tickets.length,
        limit,
        offset,
      }
    }),

  /**
   * Get ticket by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const ticket = await questionTicketRepository.findById(input.id)

      if (!ticket) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Question ticket ${input.id} not found`,
        })
      }

      return ticket
    }),

  /**
   * Create new question ticket
   */
  create: protectedProcedure
    .input(
      z.object({
        question: z.string().min(1),
        context: z.string().min(1),
        target: z.enum(['ceo', 'writer', 'editor', 'engineering']),
        createdByAgentId: z.string(),
        contentId: z.string().optional(),
        taskId: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ticket = await questionTicketRepository.create({
        question: input.question,
        context: input.context,
        target: input.target,
        created_by_agent_id: input.createdByAgentId,
        content_id: input.contentId,
        task_id: input.taskId,
        status: 'open',
        metadata: input.metadata || {},
      })

      // Publish ticket created event
      await events.ticketCreated(ticket.id, ticket.created_by_agent_id, ticket.target)

      console.log(
        `[TicketRouter] Question ticket created: ${ticket.id} by ${ctx.user.email}`
      )

      return ticket
    }),

  /**
   * Answer a question ticket (CEO only)
   */
  answer: ceoProcedure
    .input(
      z.object({
        id: z.string(),
        answer: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ticket = await questionTicketRepository.findById(input.id)
      if (!ticket) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Question ticket ${input.id} not found`,
        })
      }

      if (ticket.status !== 'open') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Ticket ${input.id} is not open (status: ${ticket.status})`,
        })
      }

      const updated = await questionTicketRepository.update(input.id, {
        answer: input.answer,
        answered_at: new Date().toISOString(),
        answered_by: ctx.user.id,
        status: 'answered',
      })

      // Publish ticket answered event
      await events.ticketAnswered(input.id, ctx.user.id)

      console.log(`[TicketRouter] Ticket ${input.id} answered by CEO`)

      return updated
    }),

  /**
   * Resolve a question ticket
   */
  resolve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ticket = await questionTicketRepository.findById(input.id)
      if (!ticket) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Question ticket ${input.id} not found`,
        })
      }

      if (ticket.status === 'resolved') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Ticket ${input.id} is already resolved`,
        })
      }

      const updated = await questionTicketRepository.update(input.id, {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })

      console.log(`[TicketRouter] Ticket ${input.id} resolved by ${ctx.user.email}`)

      return updated
    }),

  /**
   * Get open tickets for CEO dashboard
   */
  getOpenForCEO: ceoProcedure.query(async () => {
    const tickets = await questionTicketRepository.findAll({
      status: 'open',
      target: 'ceo',
    })

    return tickets
  }),

  /**
   * Get ticket statistics
   */
  getStats: publicProcedure.query(async () => {
    const [open, answered, resolved] = await Promise.all([
      questionTicketRepository.findAll({ status: 'open' }),
      questionTicketRepository.findAll({ status: 'answered' }),
      questionTicketRepository.findAll({ status: 'resolved' }),
    ])

    return {
      open: open.length,
      answered: answered.length,
      resolved: resolved.length,
      total: open.length + answered.length + resolved.length,
    }
  }),
})
