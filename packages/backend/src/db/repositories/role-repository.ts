import { Role } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for Role entities
 */
export class RoleRepository extends BaseRepository<Role> {
  constructor() {
    super('roles')
  }

  /**
   * Find roles by department
   */
  async findByDepartment(departmentId: string): Promise<Role[]> {
    return this.findBy('department_id', departmentId)
  }

  /**
   * Find role by name within a department
   */
  async findByNameAndDepartment(
    name: string,
    departmentId: string
  ): Promise<Role | null> {
    const roles = await this.findByDepartment(departmentId)
    return roles.find((r) => r.name === name) || null
  }

  /**
   * Find roles by company (via department relationship)
   */
  async findByCompany(companyId: string): Promise<Role[]> {
    const query = `
      SELECT r.*
      FROM roles r
      JOIN departments d ON r.department_id = d.id
      WHERE d.company_id = $1
    `
    const result = await db.query(query, [companyId])
    return result.rows
  }

  /**
   * Find all roles with department info included
   */
  async findAllWithDepartment(): Promise<(Role & { department: { id: string; name: string } | null })[]> {
    const query = `
      SELECT r.*,
             json_build_object('id', d.id, 'name', d.name) as department
      FROM roles r
      LEFT JOIN departments d ON r.department_id = d.id
      ORDER BY r.created_at DESC
    `
    const result = await db.query(query, [])
    return result.rows
  }
}

export const roleRepository = new RoleRepository()
