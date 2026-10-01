import type { ContentModel, CreateContentModelInput, UpdateContentModelInput } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for ContentModel entities
 */
export class ContentModelRepository extends BaseRepository<ContentModel> {
  constructor() {
    super('content_models')
  }

  /**
   * Find content model by model_id
   */
  async findByModelId(modelId: string): Promise<ContentModel | null> {
    return this.findOneBy('model_id', modelId)
  }

  /**
   * Find models by kind (atom, molecule, organism, template)
   */
  async findByKind(kind: string): Promise<ContentModel[]> {
    const result = await db.query<ContentModel>(
      `SELECT * FROM ${this.tableName} WHERE kind = $1 ORDER BY name ASC`,
      [kind]
    )
    return result.rows
  }

  /**
   * Get all models ordered by kind and name
   */
  async findAllOrdered(): Promise<ContentModel[]> {
    const result = await db.query<ContentModel>(
      `SELECT * FROM ${this.tableName}
       ORDER BY
         CASE kind
           WHEN 'atom' THEN 1
           WHEN 'molecule' THEN 2
           WHEN 'organism' THEN 3
           WHEN 'template' THEN 4
         END,
         name ASC`
    )
    return result.rows
  }

  /**
   * Build relationship graph of all models
   */
  async getRelationshipGraph(): Promise<any> {
    const models = await this.findAll()

    const nodes = models.map(model => ({
      id: model.model_id,
      name: model.name,
      kind: model.kind
    }))

    const edges: any[] = []

    models.forEach(model => {
      if (model.relations) {
        model.relations.forEach(relation => {
          edges.push({
            source: model.model_id,
            target: relation.target_model,
            type: relation.type,
            label: relation.name
          })
        })
      }
    })

    return { nodes, edges }
  }

  /**
   * Create content model with validation
   */
  async createContentModel(input: CreateContentModelInput): Promise<ContentModel> {
    // Check for duplicate model_id
    const existing = await this.findByModelId(input.model_id)
    if (existing) {
      throw new Error(`Content model with model_id "${input.model_id}" already exists`)
    }

    return this.create(input as any)
  }

  /**
   * Update content model
   */
  async updateContentModel(id: string, input: UpdateContentModelInput): Promise<ContentModel | null> {
    return this.update(id, input as any)
  }
}

export const contentModelRepository = new ContentModelRepository()
