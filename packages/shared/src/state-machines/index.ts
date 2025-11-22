/**
 * State Machine Definitions for agent.press
 * See: /domain/state-machines/STATE_MACHINES.md
 */

import {
  ContentItemStatus,
  TaskStatus,
  ReviewResult,
  QuestionTicketStatus,
} from '../types/entities'

// ============================================================================
// State Machine Types
// ============================================================================

export interface Transition<TState extends string, TEvent extends string> {
  from: TState
  to: TState
  event: TEvent
  allowedActors: string[]
}

export interface StateMachine<TState extends string, TEvent extends string> {
  name: string
  initialState: TState
  states: TState[]
  transitions: Transition<TState, TEvent>[]
  terminalStates: TState[]
}

// ============================================================================
// ContentItem State Machine
// ============================================================================

export type ContentItemEvent =
  | 'topic.accepted'
  | 'brief.created'
  | 'writer.started'
  | 'submit_for_review'
  | 'request_changes'
  | 'approve'
  | 'revisions_applied'
  | 'ready_for_publish'
  | 'deploy_success'
  | 'retire'

export const contentItemStateMachine: StateMachine<ContentItemStatus, ContentItemEvent> = {
  name: 'ContentItem',
  initialState: 'idea',
  states: [
    'idea',
    'planned',
    'brief_created',
    'draft',
    'in_editorial_review',
    'needs_changes',
    'approved',
    'scheduled',
    'published',
    'archived',
  ],
  terminalStates: ['archived'],
  transitions: [
    {
      from: 'idea',
      to: 'planned',
      event: 'topic.accepted',
      allowedActors: ['ChiefEditor', 'CEO'],
    },
    {
      from: 'planned',
      to: 'brief_created',
      event: 'brief.created',
      allowedActors: ['Editor'],
    },
    {
      from: 'brief_created',
      to: 'draft',
      event: 'writer.started',
      allowedActors: ['Writer'],
    },
    {
      from: 'draft',
      to: 'in_editorial_review',
      event: 'submit_for_review',
      allowedActors: ['Writer'],
    },
    {
      from: 'in_editorial_review',
      to: 'needs_changes',
      event: 'request_changes',
      allowedActors: ['Editor'],
    },
    {
      from: 'in_editorial_review',
      to: 'approved',
      event: 'approve',
      allowedActors: ['Editor', 'CEO'],
    },
    {
      from: 'needs_changes',
      to: 'draft',
      event: 'revisions_applied',
      allowedActors: ['Writer'],
    },
    {
      from: 'approved',
      to: 'scheduled',
      event: 'ready_for_publish',
      allowedActors: ['SEOSpecialist', 'EngineeringAgent'],
    },
    {
      from: 'scheduled',
      to: 'published',
      event: 'deploy_success',
      allowedActors: ['EngineeringAgent'],
    },
    {
      from: 'published',
      to: 'archived',
      event: 'retire',
      allowedActors: ['CEO'],
    },
  ],
}

// ============================================================================
// Task State Machine
// ============================================================================

export type TaskEvent =
  | 'agent.accepts'
  | 'error'
  | 'unblock'
  | 'finish'
  | 'cancel'

export const taskStateMachine: StateMachine<TaskStatus, TaskEvent> = {
  name: 'Task',
  initialState: 'planned',
  states: ['planned', 'in_progress', 'blocked', 'completed', 'cancelled'],
  terminalStates: ['completed', 'cancelled'],
  transitions: [
    {
      from: 'planned',
      to: 'in_progress',
      event: 'agent.accepts',
      allowedActors: ['AssignedAgent'],
    },
    {
      from: 'in_progress',
      to: 'blocked',
      event: 'error',
      allowedActors: ['AssignedAgent'],
    },
    {
      from: 'blocked',
      to: 'in_progress',
      event: 'unblock',
      allowedActors: ['AssignedAgent', 'TechnicalLead'],
    },
    {
      from: 'in_progress',
      to: 'completed',
      event: 'finish',
      allowedActors: ['AssignedAgent'],
    },
    {
      from: 'planned',
      to: 'cancelled',
      event: 'cancel',
      allowedActors: ['CEO', 'ChiefEditor'],
    },
    {
      from: 'in_progress',
      to: 'cancelled',
      event: 'cancel',
      allowedActors: ['CEO'],
    },
  ],
}

// ============================================================================
// QuestionTicket State Machine
// ============================================================================

export type QuestionTicketEvent =
  | 'answer_provided'
  | 'agent_acknowledged'
  | 'invalid_ticket'

export const questionTicketStateMachine: StateMachine<
  QuestionTicketStatus,
  QuestionTicketEvent
> = {
  name: 'QuestionTicket',
  initialState: 'open',
  states: ['open', 'answered', 'closed'],
  terminalStates: ['closed'],
  transitions: [
    {
      from: 'open',
      to: 'answered',
      event: 'answer_provided',
      allowedActors: ['CEO', 'ChiefEditor', 'TechnicalLead'],
    },
    {
      from: 'answered',
      to: 'closed',
      event: 'agent_acknowledged',
      allowedActors: ['OriginalAgent', 'CEO'],
    },
    {
      from: 'open',
      to: 'closed',
      event: 'invalid_ticket',
      allowedActors: ['CEO'],
    },
  ],
}

// ============================================================================
// State Machine Validation
// ============================================================================

export interface TransitionRequest<TState extends string, TEvent extends string> {
  currentState: TState
  event: TEvent
  actor: string
}

export interface TransitionResult<TState extends string> {
  allowed: boolean
  nextState?: TState
  error?: string
}

/**
 * Validate a state transition
 */
export function canTransition<TState extends string, TEvent extends string>(
  machine: StateMachine<TState, TEvent>,
  request: TransitionRequest<TState, TEvent>
): TransitionResult<TState> {
  const { currentState, event, actor } = request

  // Check if current state is terminal
  if (machine.terminalStates.includes(currentState)) {
    return {
      allowed: false,
      error: `Cannot transition from terminal state: ${currentState}`,
    }
  }

  // Find matching transition
  const transition = machine.transitions.find(
    (t) => t.from === currentState && t.event === event
  )

  if (!transition) {
    return {
      allowed: false,
      error: `No transition found for state=${currentState} event=${event}`,
    }
  }

  // Check actor permissions
  const actorAllowed =
    transition.allowedActors.includes(actor) ||
    transition.allowedActors.includes('AssignedAgent') || // Special case
    actor === 'CEO' // CEO can override

  if (!actorAllowed) {
    return {
      allowed: false,
      error: `Actor ${actor} not allowed to perform event ${event} in state ${currentState}`,
    }
  }

  return {
    allowed: true,
    nextState: transition.to,
  }
}

/**
 * Get all possible transitions from a given state
 */
export function getPossibleTransitions<TState extends string, TEvent extends string>(
  machine: StateMachine<TState, TEvent>,
  currentState: TState,
  actor: string
): Array<{ event: TEvent; to: TState }> {
  return machine.transitions
    .filter((t) => t.from === currentState)
    .filter(
      (t) =>
        t.allowedActors.includes(actor) ||
        t.allowedActors.includes('AssignedAgent') ||
        actor === 'CEO'
    )
    .map((t) => ({ event: t.event, to: t.to }))
}

/**
 * Check if a state is terminal
 */
export function isTerminalState<TState extends string>(
  machine: StateMachine<TState, string>,
  state: TState
): boolean {
  return machine.terminalStates.includes(state)
}
