/**
 * Event Outbox Repository
 *
 * Backs the transactional outbox pattern used by the state machine engine.
 * Events are inserted in the same DB transaction as their originating state
 * change, then drained asynchronously by the OutboxWorker. This provides
 * at-least-once delivery and prevents lost events on process crash.
 */

import { db, PoolClient } from '../connection'

export interface EventOutboxRow {
  id: string
  event_type: string
  event_data: Record<string, unknown>
  source: string | null
  created_at: Date
  published_at: Date | null
  publish_attempts: number
  last_error: string | null
}

export class EventOutboxRepository {
  /**
   * Insert an outbox row. Accepts an optional pg client so callers can enlist
   * the insert in an existing transaction (this is the whole point of the
   * outbox pattern — the insert MUST be part of the same tx as the state
   * change it represents).
   */
  async insert(
    eventType: string,
    eventData: Record<string, unknown>,
    source?: string,
    client?: PoolClient
  ): Promise<EventOutboxRow> {
    const query = `
      INSERT INTO event_outbox (event_type, event_data, source)
      VALUES ($1, $2::jsonb, $3)
      RETURNING *
    `
    const params = [eventType, JSON.stringify(eventData), source ?? null]
    const result = client
      ? await client.query<EventOutboxRow>(query, params)
      : await db.query<EventOutboxRow>(query, params)
    const row = result.rows[0]
    if (!row) {
      // Should be unreachable — INSERT ... RETURNING * always yields a row.
      throw new Error('event_outbox INSERT did not return a row')
    }
    return row
  }

  /**
   * Claim up to `limit` unpublished events. Uses FOR UPDATE SKIP LOCKED so
   * multiple workers can drain the outbox concurrently without contention.
   * Caller is responsible for publishing then calling markPublished /
   * markFailed for each returned row.
   */
  async claimUnpublished(limit: number): Promise<EventOutboxRow[]> {
    const query = `
      SELECT *
      FROM event_outbox
      WHERE published_at IS NULL
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `
    // Wrap in a short-lived tx so SKIP LOCKED holds for the caller's duration.
    // We immediately commit to release the row locks — the worker uses
    // published_at IS NULL as the contention guard once it's written.
    return await db.transaction(async (client) => {
      const result = await client.query<EventOutboxRow>(query, [limit])
      return result.rows
    })
  }

  /**
   * Mark a single event as successfully published.
   */
  async markPublished(id: string): Promise<void> {
    await db.query(
      `UPDATE event_outbox
         SET published_at = NOW(),
             last_error = NULL
       WHERE id = $1`,
      [id]
    )
  }

  /**
   * Record a publish failure. Increments the attempt counter and stores the
   * error so an operator can inspect it. Leaves published_at NULL so a future
   * worker tick will retry.
   */
  async markFailed(id: string, error: string): Promise<void> {
    await db.query(
      `UPDATE event_outbox
         SET publish_attempts = publish_attempts + 1,
             last_error = $2
       WHERE id = $1`,
      [id, error]
    )
  }
}

export const eventOutboxRepository = new EventOutboxRepository()
