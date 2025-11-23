import type { Blueprint, CreateBlueprintInput, UpdateBlueprintInput } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for Blueprint entities
 */
export class BlueprintRepository extends BaseRepository<Blueprint> {
  constructor() {
    super('blueprints')
  }

  /**
   * Find blueprint by page_type
   */
  async findByPageType(pageType: string): Promise<Blueprint | null> {
    return this.findOneBy('page_type', pageType)
  }

  /**
   * Find all blueprints ordered by name
   */
  async findAllOrdered(): Promise<Blueprint[]> {
    const result = await db.query<Blueprint>(
      `SELECT * FROM ${this.tableName} ORDER BY name ASC`
    )
    return result.rows
  }

  /**
   * Create blueprint with validation
   */
  async createBlueprint(input: CreateBlueprintInput): Promise<Blueprint> {
    // Check for duplicate page_type
    const existing = await this.findByPageType(input.page_type)
    if (existing) {
      throw new Error(`Blueprint for page_type "${input.page_type}" already exists`)
    }

    return this.create(input as any)
  }

  /**
   * Update blueprint
   */
  async updateBlueprint(id: string, input: UpdateBlueprintInput): Promise<Blueprint | null> {
    return this.update(id, input as any)
  }

  /**
   * Validate a page against its blueprint
   */
  async validatePage(pageData: any, blueprintId: string): Promise<{ valid: boolean; errors: string[] }> {
    const blueprint = await this.findById(blueprintId)
    if (!blueprint) {
      return { valid: false, errors: ['Blueprint not found'] }
    }

    const errors: string[] = []

    // Check required fields from all components
    for (const component of blueprint.components) {
      if (component.required_fields) {
        for (const field of component.required_fields) {
          if (!pageData[field]) {
            errors.push(`Missing required field: ${field} (required by ${component.type})`)
          }
        }
      }
    }

    // Check linking rules if specified
    if (blueprint.global_linking_rules) {
      const rules = blueprint.global_linking_rules
      const linkCount = (pageData.internal_links?.outgoing?.length || 0)

      if (rules.min_total_links && linkCount < rules.min_total_links) {
        errors.push(`Too few internal links: ${linkCount} (minimum: ${rules.min_total_links})`)
      }

      if (rules.max_total_links && linkCount > rules.max_total_links) {
        errors.push(`Too many internal links: ${linkCount} (maximum: ${rules.max_total_links})`)
      }
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}

export const blueprintRepository = new BlueprintRepository()
