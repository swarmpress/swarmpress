/**
 * Collection Router
 * tRPC router for database-driven collection operations
 * Collections are stored per-website with JSON Schema validation
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import {
  websiteCollectionRepository,
  collectionItemRepository,
  collectionItemVersionRepository,
} from '../../db/repositories'
import { collectionSchemaService } from '../../services/collection-schema.service'

/**
 * Collection Router
 */
export const collectionRouter = router({
  // =============================================================================
  // COLLECTION TYPES (Website-Specific Schemas)
  // =============================================================================

  /**
   * List all collection types for a website
   */
  listTypes: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        enabledOnly: z.boolean().default(true),
      })
    )
    .query(async ({ input }) => {
      const collections = await websiteCollectionRepository.findByWebsite(
        input.websiteId,
        input.enabledOnly
      )

      return collections.map((c) => ({
        id: c.id,
        type: c.collection_type,
        displayName: c.display_name,
        singularName: c.singular_name,
        description: c.description,
        icon: c.icon,
        color: c.color,
        enabled: c.enabled,
        titleField: c.title_field,
        summaryField: c.summary_field,
        imageField: c.image_field,
        dateField: c.date_field,
      }))
    }),

  /**
   * Get a specific collection type
   */
  getType: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .query(async ({ input }) => {
      const collection = await websiteCollectionRepository.findByType(
        input.websiteId,
        input.collectionType
      )

      if (!collection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type '${input.collectionType}' not found for website`,
        })
      }

      return {
        id: collection.id,
        type: collection.collection_type,
        displayName: collection.display_name,
        singularName: collection.singular_name,
        description: collection.description,
        icon: collection.icon,
        color: collection.color,
        enabled: collection.enabled,
        titleField: collection.title_field,
        summaryField: collection.summary_field,
        imageField: collection.image_field,
        dateField: collection.date_field,
        fieldMetadata: collection.field_metadata,
        enableSearch: collection.enable_search,
        enableFiltering: collection.enable_filtering,
        enableVersioning: collection.enable_versioning,
        enableGithubSync: collection.enable_github_sync,
      }
    }),

  /**
   * Get JSON Schema for a collection type
   */
  getSchema: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .query(async ({ input }) => {
      const collection = await websiteCollectionRepository.findByType(
        input.websiteId,
        input.collectionType
      )

      if (!collection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type '${input.collectionType}' not found for website`,
        })
      }

      return {
        jsonSchema: collection.json_schema,
        createSchema: collection.create_schema,
        fieldMetadata: collection.field_metadata,
      }
    }),

  /**
   * Create a new collection type for a website
   */
  createType: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        type: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Type must be lowercase alphanumeric with underscores'),
        displayName: z.string().min(1),
        singularName: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        jsonSchema: z.record(z.unknown()),
        createSchema: z.record(z.unknown()).optional(),
        fieldMetadata: z.record(z.unknown()).optional(),
        titleField: z.string().optional(),
        summaryField: z.string().optional(),
        imageField: z.string().optional(),
        dateField: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if collection type already exists
      const existing = await websiteCollectionRepository.findByType(
        input.websiteId,
        input.type
      )

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Collection type '${input.type}' already exists for this website`,
        })
      }

      const collection = await collectionSchemaService.createCollection(input.websiteId, {
        type: input.type,
        displayName: input.displayName,
        singularName: input.singularName,
        description: input.description,
        icon: input.icon,
        color: input.color,
        jsonSchema: input.jsonSchema,
        createSchema: input.createSchema,
        fieldMetadata: input.fieldMetadata,
        titleField: input.titleField,
        summaryField: input.summaryField,
        imageField: input.imageField,
        dateField: input.dateField,
      })

      return {
        id: collection.id,
        type: collection.collection_type,
        displayName: collection.display_name,
      }
    }),

  /**
   * Update collection schema
   */
  updateSchema: publicProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        jsonSchema: z.record(z.unknown()),
      })
    )
    .mutation(async ({ input }) => {
      const collection = await collectionSchemaService.updateCollectionSchema(
        input.collectionId,
        input.jsonSchema
      )

      if (!collection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection not found',
        })
      }

      return {
        id: collection.id,
        type: collection.collection_type,
        displayName: collection.display_name,
      }
    }),

  /**
   * Enable/disable a collection type
   */
  setEnabled: publicProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const collection = await websiteCollectionRepository.setEnabled(
        input.collectionId,
        input.enabled
      )

      if (!collection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection not found',
        })
      }

      return { success: true, enabled: collection.enabled }
    }),

  // =============================================================================
  // COLLECTION ITEMS (Content)
  // =============================================================================

  /**
   * Create a new collection item with validation
   */
  create: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
        data: z.record(z.unknown()),
        published: z.boolean().default(false),
        featured: z.boolean().default(false),
        createdByAgentId: z.string().uuid().optional(),
        createdByUserId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await collectionSchemaService.createItem(
        input.websiteId,
        input.collectionType,
        input.slug,
        input.data,
        {
          published: input.published,
          userId: input.createdByUserId,
          agentId: input.createdByAgentId,
        }
      )

      if (result.errors) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          cause: result.errors,
        })
      }

      // Create initial version if versioning is enabled
      const collection = await websiteCollectionRepository.findByType(
        input.websiteId,
        input.collectionType
      )

      if (collection?.enable_versioning && result.item) {
        await collectionItemVersionRepository.createVersion(result.item.id, input.data, {
          userId: input.createdByUserId,
          agentId: input.createdByAgentId,
          changeSummary: 'Initial version',
        })
      }

      return result.item
    }),

  /**
   * Update a collection item with validation
   */
  update: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        data: z.record(z.unknown()).optional(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        updatedByAgentId: z.string().uuid().optional(),
        updatedByUserId: z.string().uuid().optional(),
        changeSummary: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Get current item
      const currentItem = await collectionItemRepository.findById(input.itemId)
      if (!currentItem) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        })
      }

      // Get collection for validation and versioning
      const collection = await websiteCollectionRepository.findById(
        currentItem.website_collection_id
      )
      if (!collection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection not found',
        })
      }

      // Update data if provided
      if (input.data) {
        const result = await collectionSchemaService.updateItem(input.itemId, input.data, {
          userId: input.updatedByUserId,
          agentId: input.updatedByAgentId,
        })

        if (result.errors) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            cause: result.errors,
          })
        }

        // Create new version if versioning is enabled
        if (collection.enable_versioning) {
          await collectionItemVersionRepository.createVersion(input.itemId, input.data, {
            userId: input.updatedByUserId,
            agentId: input.updatedByAgentId,
            changeSummary: input.changeSummary,
          })
        }
      }

      // Update published/featured status
      if (input.published !== undefined) {
        await collectionItemRepository.setPublished(input.itemId, input.published)
      }

      if (input.featured !== undefined) {
        await collectionItemRepository.update(input.itemId, { featured: input.featured })
      }

      // Return updated item
      return collectionItemRepository.findById(input.itemId)
    }),

  /**
   * Delete a collection item
   */
  delete: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
      })
    )
    .mutation(async ({ input }) => {
      const item = await collectionItemRepository.findById(input.itemId)
      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        })
      }

      await collectionItemRepository.delete(input.itemId)
      return { success: true }
    }),

  /**
   * Get a collection item by ID
   */
  get: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      const item = await collectionItemRepository.findById(input.itemId)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        })
      }

      // Get collection info
      const collection = await websiteCollectionRepository.findById(item.website_collection_id)

      return {
        ...item,
        collectionType: collection?.collection_type,
        websiteId: collection?.website_id,
      }
    }),

  /**
   * Get a collection item by slug
   */
  getBySlug: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        slug: z.string(),
      })
    )
    .query(async ({ input }) => {
      const item = await collectionSchemaService.getItemBySlug(
        input.websiteId,
        input.collectionType,
        input.slug
      )

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        })
      }

      return item
    }),

  /**
   * List collection items with pagination
   */
  list: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        publishedOnly: z.boolean().default(false),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const items = await collectionSchemaService.getItems(input.websiteId, input.collectionType, {
        publishedOnly: input.publishedOnly,
        limit: input.limit,
        offset: input.offset,
        search: input.search,
      })

      // Get collection for count
      const collection = await websiteCollectionRepository.findByType(
        input.websiteId,
        input.collectionType
      )

      const total = collection
        ? await collectionItemRepository.countByCollection(collection.id, input.publishedOnly)
        : 0

      return {
        items,
        total,
        limit: input.limit,
        offset: input.offset,
      }
    }),

  /**
   * Batch create collection items
   */
  batchCreate: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        items: z.array(
          z.object({
            slug: z.string(),
            data: z.record(z.unknown()),
          })
        ),
        published: z.boolean().default(false),
        createdByAgentId: z.string().uuid().optional(),
        createdByUserId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await collectionSchemaService.batchCreateItems(
        input.websiteId,
        input.collectionType,
        input.items,
        {
          published: input.published,
          userId: input.createdByUserId,
          agentId: input.createdByAgentId,
        }
      )

      return {
        created: result.created.length,
        errors: result.errors,
      }
    }),

  // =============================================================================
  // VERSION HISTORY
  // =============================================================================

  /**
   * Get version history for an item
   */
  getVersions: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      return collectionItemVersionRepository.findByItem(input.itemId)
    }),

  /**
   * Get a specific version
   */
  getVersion: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        versionNumber: z.number().int().min(1),
      })
    )
    .query(async ({ input }) => {
      const version = await collectionItemVersionRepository.getVersion(
        input.itemId,
        input.versionNumber
      )

      if (!version) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Version ${input.versionNumber} not found`,
        })
      }

      return version
    }),

  /**
   * Restore item to a specific version
   */
  restoreVersion: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        versionNumber: z.number().int().min(1),
        restoredByAgentId: z.string().uuid().optional(),
        restoredByUserId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Get the version to restore
      const version = await collectionItemVersionRepository.getVersion(
        input.itemId,
        input.versionNumber
      )

      if (!version) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Version ${input.versionNumber} not found`,
        })
      }

      // Update item with version data
      const updatedItem = await collectionItemRepository.updateData(
        input.itemId,
        version.data,
        input.restoredByUserId,
        input.restoredByAgentId
      )

      // Create new version for the restore
      await collectionItemVersionRepository.createVersion(input.itemId, version.data, {
        userId: input.restoredByUserId,
        agentId: input.restoredByAgentId,
        changeSummary: `Restored from version ${input.versionNumber}`,
      })

      return updatedItem
    }),

  // =============================================================================
  // VALIDATION
  // =============================================================================

  /**
   * Validate data against a collection schema without creating
   */
  validate: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        data: z.record(z.unknown()),
      })
    )
    .query(async ({ input }) => {
      const result = await collectionSchemaService.validateData(
        input.websiteId,
        input.collectionType,
        input.data
      )

      return result
    }),
})
