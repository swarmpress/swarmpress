/**
 * State Machine Engine
 * Orchestrates state transitions with database transactions and event publishing
 */

import { db } from '../db/connection'
import { publishEvent } from '@agent-press/event-bus'
import {
  StateMachine,
  TransitionRequest,
  TransitionResult,
  canTransition,
} from '@agent-press/shared/state-machines'
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

// ============================================================================
// State Machine Engine
// ============================================================================

/**
 * Execute a state transition with full transactional support
 */
export async function executeTransition<TState extends string, TEvent extends string>(
  machine: StateMachine<TState, TEvent>,
  context: StateTransitionContext<TState, TEvent>
): Promise<StateTransitionResult<TState>> {
  const { entityId, entityType, currentState, event, actor, actorId, metadata } = context

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

  try {
    // 2. Execute in database transaction
    const result = await db.transaction(async (client) => {
      // Update entity state
      const updateQuery = `
        UPDATE ${getTableName(entityType)}
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `
      const updateResult = await client.query(updateQuery, [nextState, entityId])

      if (updateResult.rows.length === 0) {
        throw new Error(`Entity ${entityId} not found`)
      }

      // Create audit record
      const auditId = uuidv4()
      const auditQuery = `
        INSERT INTO state_audit_log (
          id, entity_type, entity_id, from_state, to_state, event, actor, actor_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `
      const auditResult = await client.query(auditQuery, [
        auditId,
        entityType,
        entityId,
        currentState,
        nextState,
        event,
        actor,
        actorId,
        JSON.stringify(metadata || {}),
      ])

      return {
        entity: updateResult.rows[0],
        audit: auditResult.rows[0] as StateAuditRecord,
      }
    })

    // 3. Emit CloudEvent (outside transaction to avoid blocking)
    await publishEvent({
      type: `${entityType}.state_changed`,
      source: `/state-machine/${machine.name}`,
      subject: `${entityType}/${entityId}`,
      data: {
        entity_id: entityId,
        entity_type: entityType,
        from_state: currentState,
        to_state: nextState,
        event,
        actor,
        actor_id: actorId,
        audit_id: result.audit.id,
        metadata,
      },
    })

    return {
      success: true,
      newState: nextState,
      auditId: result.audit.id,
    }
  } catch (error) {
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
