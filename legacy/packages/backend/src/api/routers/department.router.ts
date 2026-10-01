/**
 * Department API Router
 * Endpoints for managing departments within companies
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { departmentRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const departmentRouter = router({
  /**
   * Get all departments, optionally filtered by company
   */
  list: publicProcedure
    .input(
      z.object({
        companyId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      const departments = input.companyId
        ? await departmentRepository.findByCompany(input.companyId)
        : await departmentRepository.findAll()

      return {
        items: departments,
        total: departments.length,
      }
    }),

  /**
   * Get department by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const department = await departmentRepository.findById(input.id)

      if (!department) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Department ${input.id} not found`,
        })
      }

      return department
    }),

  /**
   * Create new department
   */
  create: ceoProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        companyId: z.string().uuid(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if department with same name exists in this company
      const existing = await departmentRepository.findByNameAndCompany(
        input.name,
        input.companyId
      )
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Department "${input.name}" already exists in this company`,
        })
      }

      const department = await departmentRepository.create({
        name: input.name as any,
        company_id: input.companyId,
        description: input.description,
      })

      console.log(
        `[DepartmentRouter] Department created: ${department.id} - ${department.name}`
      )

      return department
    }),

  /**
   * Update department
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

      const existing = await departmentRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Department ${id} not found`,
        })
      }

      const department = await departmentRepository.update(id, updates as any)

      if (!department) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update department',
        })
      }

      console.log(`[DepartmentRouter] Department updated: ${department.id}`)

      return department
    }),

  /**
   * Delete department
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await departmentRepository.findById(input.id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Department ${input.id} not found`,
        })
      }

      await departmentRepository.delete(input.id)

      console.log(`[DepartmentRouter] Department deleted: ${input.id}`)

      return { success: true }
    }),
})
