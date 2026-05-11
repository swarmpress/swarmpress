/**
 * PR ↔ Content Mapping Repository
 *
 * Maps GitHub Pull Requests to content_items so the EditorAgent can locate
 * the correct PR to merge / comment on / close when acting on a contentId.
 *
 * Used by the repo-canonical content workflow:
 *   - WS2 (WriterAgent) inserts a row when it opens a PR for a draft branch.
 *   - WS3 (EditorAgent) reads the row to find the PR for a given contentId.
 *   - WS4 (this package) keeps the row in sync via webhooks (opened/closed/merged).
 */

import { db, PoolClient } from '../connection'

export interface PrContentMappingRow {
  id: string
  website_id: string
  content_id: string | null
  pr_number: number
  pr_url: string
  branch_name: string
  created_by_agent_id: string | null
  created_at: Date
  merged_at: Date | null
  closed_at: Date | null
}

export interface UpsertByPrNumberInput {
  websiteId: string
  prNumber: number
  prUrl: string
  branchName: string
  contentId?: string | null
  createdByAgentId?: string | null
}

export class PrContentMappingRepository {
  /**
   * Insert a mapping row, or update it if a row already exists for this
   * (websiteId, prNumber). Idempotent — safe to call from webhook handlers
   * that may receive duplicate deliveries.
   *
   * NOTE: when updating, we only overwrite contentId / createdByAgentId if
   * the caller actually provides values. This lets a webhook (which may not
   * know the contentId) safely upsert without nulling a value that an agent
   * previously recorded when opening the PR.
   */
  async upsertByPrNumber(
    input: UpsertByPrNumberInput,
    client?: PoolClient
  ): Promise<PrContentMappingRow> {
    const query = `
      INSERT INTO pr_content_mappings
        (website_id, content_id, pr_number, pr_url, branch_name, created_by_agent_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (website_id, pr_number) DO UPDATE SET
        pr_url = EXCLUDED.pr_url,
        branch_name = EXCLUDED.branch_name,
        content_id = COALESCE(EXCLUDED.content_id, pr_content_mappings.content_id),
        created_by_agent_id = COALESCE(EXCLUDED.created_by_agent_id, pr_content_mappings.created_by_agent_id)
      RETURNING *
    `
    const params = [
      input.websiteId,
      input.contentId ?? null,
      input.prNumber,
      input.prUrl,
      input.branchName,
      input.createdByAgentId ?? null,
    ]
    const result = client
      ? await client.query<PrContentMappingRow>(query, params)
      : await db.query<PrContentMappingRow>(query, params)
    const row = result.rows[0]
    if (!row) {
      // Should be unreachable — INSERT ... RETURNING * always yields a row.
      throw new Error('pr_content_mappings INSERT did not return a row')
    }
    return row
  }

  /**
   * Find ALL open mappings for a content item (merged_at IS NULL AND closed_at IS NULL).
   * In well-behaved workflows there should be at most one, but multiple could exist
   * if a draft has had several PRs opened against it. Caller decides how to handle.
   */
  async findByContentId(contentId: string): Promise<PrContentMappingRow[]> {
    const result = await db.query<PrContentMappingRow>(
      `SELECT *
         FROM pr_content_mappings
        WHERE content_id = $1
          AND merged_at IS NULL
          AND closed_at IS NULL
        ORDER BY created_at DESC`,
      [contentId]
    )
    return result.rows
  }

  /**
   * Find the single open mapping for a content item, or null if none exists.
   * Returns the most-recently-created open mapping when multiple are present.
   *
   * WS3 uses this to look up `{prNumber, prUrl, branchName}` for an editorial action.
   */
  async findActiveByContentId(
    contentId: string
  ): Promise<{ prNumber: number; prUrl: string; branchName: string } | null> {
    const result = await db.query<PrContentMappingRow>(
      `SELECT *
         FROM pr_content_mappings
        WHERE content_id = $1
          AND merged_at IS NULL
          AND closed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [contentId]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      branchName: row.branch_name,
    }
  }

  /**
   * Find an open mapping by branch name (used for direct-push detection — i.e.
   * when something pushes to a `drafts/content-*` branch without a PR yet, or
   * when a webhook arrives before the agent has recorded the contentId).
   */
  async findByBranchName(
    websiteId: string,
    branchName: string
  ): Promise<PrContentMappingRow | null> {
    const result = await db.query<PrContentMappingRow>(
      `SELECT *
         FROM pr_content_mappings
        WHERE website_id = $1
          AND branch_name = $2
          AND merged_at IS NULL
          AND closed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [websiteId, branchName]
    )
    return result.rows[0] ?? null
  }

  /**
   * Mark a PR as merged. Idempotent — repeated webhook deliveries are safe.
   */
  async markMerged(
    websiteId: string,
    prNumber: number,
    mergedAt: Date
  ): Promise<PrContentMappingRow | null> {
    const result = await db.query<PrContentMappingRow>(
      `UPDATE pr_content_mappings
          SET merged_at = $3
        WHERE website_id = $1
          AND pr_number = $2
          AND merged_at IS NULL
        RETURNING *`,
      [websiteId, prNumber, mergedAt]
    )
    return result.rows[0] ?? null
  }

  /**
   * Mark a PR as closed (without merge). Idempotent.
   */
  async markClosed(
    websiteId: string,
    prNumber: number,
    closedAt: Date
  ): Promise<PrContentMappingRow | null> {
    const result = await db.query<PrContentMappingRow>(
      `UPDATE pr_content_mappings
          SET closed_at = $3
        WHERE website_id = $1
          AND pr_number = $2
          AND closed_at IS NULL
          AND merged_at IS NULL
        RETURNING *`,
      [websiteId, prNumber, closedAt]
    )
    return result.rows[0] ?? null
  }
}

export const prContentMappingRepository = new PrContentMappingRepository()
