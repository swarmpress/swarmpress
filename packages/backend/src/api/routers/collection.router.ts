/**
 * Collection Router
 * tRPC router for collection operations
 */

import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import {
  validateCollectionData,
  validateCreateCollectionData,
  getCollectionSchema,
  getCreateCollectionSchema,
  getAllCollectionInfo,
  getCollectionInfo,
  isValidCollectionType,
  formatValidationErrors,
  type CollectionType,
} from '@swarm-press/shared';

/**
 * Collection Router
 */
export const collectionRouter = router({
  // =============================================================================
  // GET COLLECTION TYPES
  // =============================================================================

  /**
   * List all available collection types
   */
  listTypes: publicProcedure.query(async () => {
    return getAllCollectionInfo();
  }),

  /**
   * Get information about a specific collection type
   */
  getType: publicProcedure
    .input(
      z.object({
        type: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!isValidCollectionType(input.type)) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type not found: ${input.type}`,
        });
      }

      return getCollectionInfo(input.type as CollectionType);
    }),

  /**
   * Get schema for a collection type
   */
  getSchema: publicProcedure
    .input(
      z.object({
        type: z.string(),
      })
    )
    .query(async ({ input }) => {
      if (!isValidCollectionType(input.type)) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type not found: ${input.type}`,
        });
      }

      const schema = getCollectionSchema(input.type as CollectionType);
      const createSchema = getCreateCollectionSchema(input.type as CollectionType);

      // Return JSON Schema representation
      return {
        schema: schema._def,
        createSchema: createSchema._def,
      };
    }),

  // =============================================================================
  // WEBSITE COLLECTIONS (CONFIGURATION)
  // =============================================================================

  /**
   * Enable a collection type for a website
   */
  enable: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        config: z
          .object({
            displayName: z.string().optional(),
            icon: z.string().optional(),
            color: z.string().optional(),
            customFields: z.array(z.any()).optional(),
            fieldOverrides: z.record(z.any()).optional(),
            enableComments: z.boolean().optional(),
            enableRatings: z.boolean().optional(),
            enableBookmarks: z.boolean().optional(),
            githubPath: z.string().optional(),
            autoSync: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!isValidCollectionType(input.collectionType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid collection type: ${input.collectionType}`,
        });
      }

      const config = input.config || {};

      const result = await ctx.db.query(
        `INSERT INTO website_collections (
          website_id, collection_type, enabled,
          display_name, icon, color,
          custom_fields, field_overrides,
          enable_comments, enable_ratings, enable_bookmarks,
          github_path, auto_sync
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (website_id, collection_type)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          display_name = EXCLUDED.display_name,
          icon = EXCLUDED.icon,
          color = EXCLUDED.color,
          custom_fields = EXCLUDED.custom_fields,
          field_overrides = EXCLUDED.field_overrides,
          enable_comments = EXCLUDED.enable_comments,
          enable_ratings = EXCLUDED.enable_ratings,
          enable_bookmarks = EXCLUDED.enable_bookmarks,
          github_path = EXCLUDED.github_path,
          auto_sync = EXCLUDED.auto_sync,
          updated_at = NOW()
        RETURNING *`,
        [
          input.websiteId,
          input.collectionType,
          true,
          config.displayName || null,
          config.icon || null,
          config.color || null,
          JSON.stringify(config.customFields || []),
          JSON.stringify(config.fieldOverrides || {}),
          config.enableComments ?? false,
          config.enableRatings ?? false,
          config.enableBookmarks ?? false,
          config.githubPath || null,
          config.autoSync ?? true,
        ]
      );

      return result.rows[0];
    }),

  /**
   * Disable a collection type for a website
   */
  disable: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.db.query(
        `UPDATE website_collections
         SET enabled = false, updated_at = NOW()
         WHERE website_id = $1 AND collection_type = $2`,
        [input.websiteId, input.collectionType]
      );

      return { success: true };
    }),

  /**
   * List enabled collections for a website
   */
  listForWebsite: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT * FROM website_collections
         WHERE website_id = $1 AND enabled = true
         ORDER BY collection_type`,
        [input.websiteId]
      );

      return result.rows;
    }),

  // =============================================================================
  // COLLECTION ITEMS (CONTENT)
  // =============================================================================

  /**
   * Create a new collection item
   */
  create: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        slug: z.string(),
        data: z.any(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        createdByAgentId: z.string().uuid().optional(),
        createdByUserId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validate collection type
      if (!isValidCollectionType(input.collectionType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid collection type: ${input.collectionType}`,
        });
      }

      // Validate data against schema
      const validation = validateCreateCollectionData(
        input.collectionType as CollectionType,
        input.data
      );

      if (!validation.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          cause: formatValidationErrors(validation.error),
        });
      }

      // Get website collection ID
      const websiteCollectionResult = await ctx.db.query(
        `SELECT id FROM website_collections
         WHERE website_id = $1 AND collection_type = $2 AND enabled = true`,
        [input.websiteId, input.collectionType]
      );

      if (websiteCollectionResult.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type ${input.collectionType} is not enabled for this website`,
        });
      }

      const websiteCollectionId = websiteCollectionResult.rows[0].id;

      // Insert collection item
      const result = await ctx.db.query(
        `INSERT INTO collection_items (
          website_collection_id, slug, data, published, featured,
          created_by_agent_id, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          websiteCollectionId,
          input.slug,
          JSON.stringify(validation.data),
          input.published ?? false,
          input.featured ?? false,
          input.createdByAgentId || null,
          input.createdByUserId || null,
        ]
      );

      // Create initial version
      await ctx.db.query(
        `INSERT INTO collection_item_versions (
          item_id, version_number, data,
          created_by_agent_id, created_by_user_id,
          change_summary
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          result.rows[0].id,
          1,
          JSON.stringify(validation.data),
          input.createdByAgentId || null,
          input.createdByUserId || null,
          'Initial version',
        ]
      );

      return result.rows[0];
    }),

  /**
   * Update a collection item
   */
  update: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        data: z.any().optional(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        updatedByAgentId: z.string().uuid().optional(),
        updatedByUserId: z.string().uuid().optional(),
        changeSummary: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Get current item with collection info
      const currentResult = await ctx.db.query(
        `SELECT ci.*, wc.collection_type
         FROM collection_items ci
         JOIN website_collections wc ON ci.website_collection_id = wc.id
         WHERE ci.id = $1`,
        [input.itemId]
      );

      if (currentResult.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        });
      }

      const currentItem = currentResult.rows[0];
      const collectionType = currentItem.collection_type as CollectionType;

      // Validate data if provided
      let validatedData = currentItem.data;
      if (input.data) {
        const validation = validateCollectionData(collectionType, input.data);

        if (!validation.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Validation failed',
            cause: formatValidationErrors(validation.error),
          });
        }

        validatedData = validation.data;
      }

      // Build update query
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (input.data) {
        updates.push(`data = $${paramIndex++}`);
        values.push(JSON.stringify(validatedData));
      }

      if (input.published !== undefined) {
        updates.push(`published = $${paramIndex++}`);
        values.push(input.published);

        if (input.published) {
          updates.push(`published_at = NOW()`);
        }
      }

      if (input.featured !== undefined) {
        updates.push(`featured = $${paramIndex++}`);
        values.push(input.featured);
      }

      if (input.updatedByAgentId) {
        updates.push(`updated_by_agent_id = $${paramIndex++}`);
        values.push(input.updatedByAgentId);
      }

      if (input.updatedByUserId) {
        updates.push(`updated_by_user_id = $${paramIndex++}`);
        values.push(input.updatedByUserId);
      }

      updates.push(`updated_at = NOW()`);

      values.push(input.itemId);

      // Update item
      const result = await ctx.db.query(
        `UPDATE collection_items
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      // Create new version if data changed
      if (input.data) {
        // Get latest version number
        const versionResult = await ctx.db.query(
          `SELECT MAX(version_number) as max_version
           FROM collection_item_versions
           WHERE item_id = $1`,
          [input.itemId]
        );

        const nextVersion = (versionResult.rows[0].max_version || 0) + 1;

        await ctx.db.query(
          `INSERT INTO collection_item_versions (
            item_id, version_number, data,
            created_by_agent_id, created_by_user_id,
            change_summary
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.itemId,
            nextVersion,
            JSON.stringify(validatedData),
            input.updatedByAgentId || null,
            input.updatedByUserId || null,
            input.changeSummary || `Version ${nextVersion}`,
          ]
        );
      }

      return result.rows[0];
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
    .mutation(async ({ input, ctx }) => {
      await ctx.db.query('DELETE FROM collection_items WHERE id = $1', [input.itemId]);

      return { success: true };
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
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT ci.*, wc.collection_type, wc.website_id
         FROM collection_items ci
         JOIN website_collections wc ON ci.website_collection_id = wc.id
         WHERE ci.id = $1`,
        [input.itemId]
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        });
      }

      return result.rows[0];
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
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT ci.*, wc.collection_type, wc.website_id
         FROM collection_items ci
         JOIN website_collections wc ON ci.website_collection_id = wc.id
         WHERE wc.website_id = $1
           AND wc.collection_type = $2
           AND ci.slug = $3`,
        [input.websiteId, input.collectionType, input.slug]
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Collection item not found',
        });
      }

      return result.rows[0];
    }),

  /**
   * List collection items
   */
  list: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string().optional(),
        published: z.boolean().optional(),
        featured: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions: string[] = ['wc.website_id = $1'];
      const params: any[] = [input.websiteId];
      let paramIndex = 2;

      if (input.collectionType) {
        conditions.push(`wc.collection_type = $${paramIndex++}`);
        params.push(input.collectionType);
      }

      if (input.published !== undefined) {
        conditions.push(`ci.published = $${paramIndex++}`);
        params.push(input.published);
      }

      if (input.featured !== undefined) {
        conditions.push(`ci.featured = $${paramIndex++}`);
        params.push(input.featured);
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await ctx.db.query(
        `SELECT COUNT(*) as count
         FROM collection_items ci
         JOIN website_collections wc ON ci.website_collection_id = wc.id
         WHERE ${whereClause}`,
        params
      );

      const total = parseInt(countResult.rows[0].count);

      // Get items
      const itemsResult = await ctx.db.query(
        `SELECT ci.*, wc.collection_type, wc.website_id
         FROM collection_items ci
         JOIN website_collections wc ON ci.website_collection_id = wc.id
         WHERE ${whereClause}
         ORDER BY ci.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, input.limit, input.offset]
      );

      return {
        items: itemsResult.rows,
        total,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get version history for an item
   */
  getVersions: publicProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT * FROM collection_item_versions
         WHERE item_id = $1
         ORDER BY version_number DESC`,
        [input.itemId]
      );

      return result.rows;
    }),
});
