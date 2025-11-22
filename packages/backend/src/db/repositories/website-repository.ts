import { Website } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'

/**
 * Repository for Website entities
 */
export class WebsiteRepository extends BaseRepository<Website> {
  constructor() {
    super('websites')
  }

  /**
   * Find website by domain
   */
  async findByDomain(domain: string): Promise<Website | null> {
    return this.findOneBy('domain', domain)
  }

  /**
   * Find all websites with pagination
   */
  async findAll(options?: {
    limit?: number
    offset?: number
  }): Promise<Website[]> {
    return super.findAll(options?.limit, options?.offset)
  }
}

/**
 * Singleton instance
 */
export const websiteRepository = new WebsiteRepository()
