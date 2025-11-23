/**
 * Role API Router
 * Endpoints for managing roles within departments
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { roleRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const roleRouter = router({
  /**
   * Get all roles, optionally filtered by department or company
   */
  list: publicProcedure
    .input(
      z.object({
        departmentId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      let roles
      if (input.departmentId) {
        roles = await roleRepository.findByDepartment(input.departmentId)
      } else if (input.companyId) {
        roles = await roleRepository.findByCompany(input.companyId)
      } else {
        roles = await roleRepository.findAll()
      }

      return {
        items: roles,
        total: roles.length,
      }
    }),

  /**
   * Get role by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const role = await roleRepository.findById(input.id)

      if (!role) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Role ${input.id} not found`,
        })
      }

      return role
    }),

  /**
   * Create new role
   */
  create: ceoProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        departmentId: z.string().uuid(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if role with same name exists in this department
      const existing = await roleRepository.findByNameAndDepartment(
        input.name,
        input.departmentId
      )
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Role "${input.name}" already exists in this department`,
        })
      }

      const role = await roleRepository.create({
        name: input.name,
        department_id: input.departmentId,
        description: input.description,
      })

      console.log(`[RoleRouter] Role created: ${role.id} - ${role.name}`)

      return role
    }),

  /**
   * Update role
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

      const existing = await roleRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Role ${id} not found`,
        })
      }

      const role = await roleRepository.update(id, updates)

      if (!role) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update role',
        })
      }

      console.log(`[RoleRouter] Role updated: ${role.id}`)

      return role
    }),

  /**
   * Delete role
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await roleRepository.findById(input.id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Role ${input.id} not found`,
        })
      }

      await roleRepository.delete(input.id)

      console.log(`[RoleRouter] Role deleted: ${input.id}`)

      return { success: true }
    }),
})
