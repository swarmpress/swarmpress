import { Department } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'

/**
 * Repository for Department entities
 */
export class DepartmentRepository extends BaseRepository<Department> {
  constructor() {
    super('departments')
  }

  /**
   * Find departments by company
   */
  async findByCompany(companyId: string): Promise<Department[]> {
    return this.findBy('company_id', companyId)
  }

  /**
   * Find department by name within a company
   */
  async findByNameAndCompany(
    name: string,
    companyId: string
  ): Promise<Department | null> {
    const departments = await this.findByCompany(companyId)
    return departments.find((d) => d.name === name) || null
  }
}

export const departmentRepository = new DepartmentRepository()
