/**
 * Company (Tenant) API Router
 * Endpoints for managing media house tenants
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { companyRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const companyRouter = router({
  /**
   * Get all companies (tenants)
   */
  list: publicProcedure.query(async () => {
    const companies = await companyRepository.listAll()
    return {
      items: companies,
      total: companies.length,
    }
  }),

  /**
   * Get company by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const company = await companyRepository.findById(input.id)

      if (!company) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Company ${input.id} not found`,
        })
      }

      return company
    }),

  /**
   * Create new company (tenant)
   */
  create: ceoProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if company with same name exists
      const existing = await companyRepository.findByName(input.name)
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Company with name "${input.name}" already exists`,
        })
      }

      const company = await companyRepository.create({
        name: input.name,
        description: input.description,
      })

      console.log(`[CompanyRouter] Company created: ${company.id} - ${company.name}`)

      return company
    }),

  /**
   * Update company
   */
  update: ceoProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input

      const existing = await companyRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Company ${id} not found`,
        })
      }

      const company = await companyRepository.update(id, updates)

      if (!company) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update company',
        })
      }

      console.log(`[CompanyRouter] Company updated: ${company.id}`)

      return company
    }),

  /**
   * Delete company
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await companyRepository.findById(input.id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Company ${input.id} not found`,
        })
      }

      await companyRepository.delete(input.id)

      console.log(`[CompanyRouter] Company deleted: ${input.id}`)

      return { success: true }
    }),
})
