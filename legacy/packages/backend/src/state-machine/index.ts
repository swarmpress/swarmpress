/**
 * State Machine Engine Package
 * Exports all state machine engine functionality
 */

export {
  executeTransition,
  getAuditTrail,
  getStateTransitions,
  getTransitionStats,
} from './engine'

export type {
  StateTransitionContext,
  StateTransitionResult,
  StateAuditRecord,
} from './engine'
