/**
 * Suggestion Router
 * API endpoints for AI agent suggestions
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { suggestionRepository } from '../../db/repositories'

export const suggestionRouter = router({
  /**
   * Create a new suggestion
   */
  create: publicProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        agentId: z.string().uuid(),
        suggestionType: z.enum(['new_page', 'improve_content', 'add_links', 'update_blueprint']),
        reason: z.string().min(1),
        estimatedValue: z.enum(['low', 'medium', 'high']),
        proposedSlug: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        metadata: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const suggestion = await suggestionRepository.create({
        page_id: input.pageId,
        agent_id: input.agentId,
        suggestion_type: input.suggestionType,
        reason: input.reason,
        estimated_value: input.estimatedValue,
        proposed_slug: input.proposedSlug,
        keywords: input.keywords,
        metadata: input.metadata,
      })

      return { success: true, suggestion }
    }),

  /**
   * Get all suggestions for a page
   */
  getByPage: publicProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ input }) => {
      const suggestions = await suggestionRepository.findByPage(input.pageId)
      return { suggestions }
    }),

  /**
   * Get all suggestions for a website
   */
  getByWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const suggestions = await suggestionRepository.findByWebsite(input.websiteId)
      return { suggestions }
    }),

  /**
   * Get pending suggestions for a website (sorted by priority)
   */
  getPendingByWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const suggestions = await suggestionRepository.findPendingByWebsite(input.websiteId)
      return { suggestions }
    }),

  /**
   * Get suggestions by agent
   */
  getByAgent: publicProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => {
      const suggestions = await suggestionRepository.findByAgent(input.agentId)
      return { suggestions }
    }),

  /**
   * Update suggestion status
   */
  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['pending', 'accepted', 'rejected', 'implemented']),
        notes: z.string().optional(),
        implementedBy: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const suggestion = await suggestionRepository.updateStatus(
        input.id,
        input.status,
        input.notes,
        input.implementedBy
      )

      return { success: true, suggestion }
    }),

  /**
   * Delete a suggestion
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await suggestionRepository.delete(input.id)
      return { success: true }
    }),

  /**
   * Get suggestion statistics for a website
   */
  getStatistics: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const statistics = await suggestionRepository.getStatistics(input.websiteId)
      return { statistics }
    }),
})
