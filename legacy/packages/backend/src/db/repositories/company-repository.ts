import { Company } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'

/**
 * Repository for Company (Tenant) entities
 */
export class CompanyRepository extends BaseRepository<Company> {
  constructor() {
    super('companies')
  }

  /**
   * Find company by name
   */
  async findByName(name: string): Promise<Company | null> {
    return this.findOneBy('name', name)
  }

  /**
   * Get all companies with their metadata
   */
  async listAll(): Promise<Company[]> {
    return this.findAll()
  }
}

export const companyRepository = new CompanyRepository()
