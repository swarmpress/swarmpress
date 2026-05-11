/**
 * State Machine Engine
 * Orchestrates state transitions with database transactions and event publishing
 *
 * Event delivery uses a transactional outbox: state update, audit log insert,
 * and CloudEvent enqueue all happen in the SAME database transaction. The
 * OutboxWorker drains the `event_outbox` table asynchronously and publishes to
 * NATS. This guarantees at-least-once delivery — even if the process crashes
 * between commit and publish, the event will be picked up on next worker tick.
 *
 * To deliver outbox events, start the OutboxWorker service from your application bootstrap
 *   import { outboxWorker } from '../services/outbox-worker.service'
 *   outboxWorker.start()
 */

import { db } from '../db/connection'
import { eventOutboxRepository } from '../db/repositories/event-outbox-repository'
import {
  StateMachine,
  canTransition,
} from '@swarm-press/shared'
import { v4 as uuidv4 } from 'uuid'

// ============================================================================
// Types
// ============================================================================

export interface StateTransitionContext<TState extends string, TEvent extends string> {
  entityId: string
  entityType: 'content_item' | 'task' | 'question_ticket'
  currentState: TState
  event: TEvent
  actor: string
  actorId: string
  metadata?: Record<string, unknown>
  /**
   * Optional optimistic-lock token — pass the entity's `updated_at` value as
   * read at the start of your operation. If the row has been touched since,
   * the transition will fail with StateTransitionConflict instead of
   * silently overwriting concurrent work. If omitted, the engine will fetch
   * the current updated_at itself (one extra query, no concurrency guard
   * across the gap between fetch and update).
   */
  expectedUpdatedAt?: Date | string
}

export interface StateTransitionResult<TState extends string> {
  success: boolean
  newState?: TState
  error?: string
  auditId?: string
}

export interface StateAuditRecord {
  id: string
  entity_type: string
  entity_id: string
  from_state: string
  to_state: string
  event: string
  actor: string
  actor_id: string
  metadata: Record<string, unknown>
  created_at: Date
}

/**
 * Thrown when an optimistic-lock check fails — i.e. the entity row was
 * modified between read and write. Callers may catch this and retry with a
 * fresh read.
 */
export class StateTransitionConflict extends Error {
  public readonly entityId: string
  public readonly entityType: string
  public readonly fromState: string
  public readonly toState: string
  public readonly event: string

  constructor(params: {
    entityId: string
    entityType: string
    fromState: string
    toState: string
    event: string
  }) {
    super(
      `State transition conflict on ${params.entityType}/${params.entityId}: ` +
        `${params.fromState} -> ${params.toState} (event: ${params.event}). ` +
        `Row was modified concurrently — retry with fresh state.`
    )
    this.name = 'StateTransitionConflict'
    this.entityId = params.entityId
    this.entityType = params.entityType
    this.fromState = params.fromState
    this.toState = params.toState
    this.event = params.event
  }
}

// ============================================================================
// State Machine Engine
// ============================================================================

/**
 * Execute a state transition with full transactional support.
 *
 * Transactionality:
 *   - Entity status update, audit log insert, and outbox event enqueue all
 *     run in a single DB transaction.
 *   - Update uses an optimistic-lock predicate on `updated_at`; concurrent
 *     modifications produce StateTransitionConflict.
 *   - CloudEvent publication happens out-of-band via OutboxWorker (see file
 *     header).
 */
export async function executeTransition<TState extends string, TEvent extends string>(
  machine: StateMachine<TState, TEvent>,
  context: StateTransitionContext<TState, TEvent>
): Promise<StateTransitionResult<TState>> {
  const {
    entityId,
    entityType,
    currentState,
    event,
    actor,
    actorId,
    metadata,
    expectedUpdatedAt,
  } = context

  // 1. Validate the transition
  const validation = canTransition<TState, TEvent>(machine, {
    currentState,
    event,
    actor,
  })

  if (!validation.allowed) {
    return {
      success: false,
      error: validation.error,
    }
  }

  const nextState = validation.nextState!
  const tableName = getTableName(entityType)

  try {
    // 2. Execute in database transaction (state update + audit + outbox enqueue)
    const result = await db.transaction(async (client) => {
      // 2a. Lock the row.
      //   - If caller supplied `expectedUpdatedAt`, do an OPTIMISTIC check:
      //     fail with StateTransitionConflict if the row was modified since
      //     the caller read it.
      //   - Otherwise, take a PESSIMISTIC `SELECT … FOR UPDATE` lock so
      //     concurrent transitions serialise instead of racing.
      //
      //   Why pessimistic by default: TIMESTAMPTZ has microsecond precision
      //   but JS Date is millisecond precision; round-tripping a fetched
      //   updated_at and comparing back via `WHERE updated_at = $` can lose
      //   sub-millisecond bits and report a phantom conflict even with no
      //   concurrent writes. Row locking sidesteps the precision question
      //   entirely. Callers that do their own read+write windows can still
      //   get optimistic semantics by passing expectedUpdatedAt explicitly.
      let updateResult: { rows: Array<Record<string, unknown>> }
      if (expectedUpdatedAt !== undefined) {
        const updateQuery = `
          UPDATE ${tableName}
          SET status = $1, updated_at = NOW()
          WHERE id = $2 AND updated_at = $3
          RETURNING *
        `
        updateResult = await client.query(updateQuery, [
          nextState,
          entityId,
          expectedUpdatedAt,
        ])
        if (updateResult.rows.length === 0) {
          const exists = await client.query<{ id: string }>(
            `SELECT id FROM ${tableName} WHERE id = $1`,
            [entityId]
          )
          if (exists.rows.length === 0) {
            throw new Error(`Entity ${entityId} not found`)
          }
          throw new StateTransitionConflict({
            entityId,
            entityType,
            fromState: currentState,
            toState: nextState,
            event,
          })
        }
      } else {
        // Pessimistic path
        const lockRes = await client.query<{ id: string }>(
          `SELECT id FROM ${tableName} WHERE id = $1 FOR UPDATE`,
          [entityId]
        )
        if (lockRes.rows.length === 0) {
          throw new Error(`Entity ${entityId} not found`)
        }
        updateResult = await client.query(
          `UPDATE ${tableName} SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [nextState, entityId]
        )
      }

      // 2c. Create audit record
      // NOTE: state_audit_log schema uses (entity_type, entity_id, from_state,
      // to_state, actor_type, actor_id, metadata). There is no `event` or
      // `actor` column — `event` is folded into `metadata.event` and
      // `actor_type` replaces `actor`. This matches 000_schema.sql.
      const auditId = uuidv4()
      const auditQuery = `
        INSERT INTO state_audit_log (
          id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `
      const auditResult = await client.query(auditQuery, [
        auditId,
        entityType,
        entityId,
        currentState,
        nextState,
        actor,
        actorId,
        JSON.stringify({ ...(metadata || {}), event }),
      ])

      // 2d. Enqueue CloudEvent in the SAME transaction (transactional outbox).
      //     Drained asynchronously by OutboxWorker — see file header.
      await eventOutboxRepository.insert(
        `${entityType}.state_changed`,
        {
          entity_id: entityId,
          entity_type: entityType,
          from_state: currentState,
          to_state: nextState,
          event,
          actor,
          actor_id: actorId,
          audit_id: auditId,
          metadata,
          subject: `${entityType}/${entityId}`,
        },
        `/state-machine/${machine.name}`,
        client
      )

      return {
        entity: updateResult.rows[0],
        audit: auditResult.rows[0] as StateAuditRecord,
      }
    })

    return {
      success: true,
      newState: nextState,
      auditId: result.audit.id,
    }
  } catch (error) {
    // Re-throw conflicts so callers can catch and retry — they signal a
    // recoverable race, not a logic error.
    if (error instanceof StateTransitionConflict) {
      throw error
    }
    console.error('State transition failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get audit trail for an entity
 */
export async function getAuditTrail(
  entityType: string,
  entityId: string
): Promise<StateAuditRecord[]> {
  const query = `
    SELECT * FROM state_audit_log
    WHERE entity_type = $1 AND entity_id = $2
    ORDER BY created_at DESC
  `
  const result = await db.query<StateAuditRecord>(query, [entityType, entityId])
  return result.rows
}

/**
 * Get all state transitions for an entity type in a time range
 */
export async function getStateTransitions(
  entityType: string,
  startDate: Date,
  endDate: Date
): Promise<StateAuditRecord[]> {
  const query = `
    SELECT * FROM state_audit_log
    WHERE entity_type = $1
      AND created_at >= $2
      AND created_at <= $3
    ORDER BY created_at DESC
  `
  const result = await db.query<StateAuditRecord>(query, [entityType, startDate, endDate])
  return result.rows
}

/**
 * Get statistics about state transitions
 */
export async function getTransitionStats(entityType: string): Promise<
  Array<{
    from_state: string
    to_state: string
    event: string
    count: number
  }>
> {
  const query = `
    SELECT
      from_state,
      to_state,
      event,
      COUNT(*) as count
    FROM state_audit_log
    WHERE entity_type = $1
    GROUP BY from_state, to_state, event
    ORDER BY count DESC
  `
  const result = await db.query(query, [entityType])
  return result.rows as Array<{
    from_state: string
    to_state: string
    event: string
    count: number
  }>
}

// ============================================================================
// Helpers
// ============================================================================

function getTableName(entityType: string): string {
  switch (entityType) {
    case 'content_item':
      return 'content_items'
    case 'task':
      return 'tasks'
    case 'question_ticket':
      return 'question_tickets'
    default:
      throw new Error(`Unknown entity type: ${entityType}`)
  }
}
