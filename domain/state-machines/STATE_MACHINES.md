# State Machine Definitions

**Version:** 1.0
**Status:** Canonical
**Last Updated:** 2025-11-22

---

## Purpose

State machines define the allowed states and transitions for core entities in agent.press. They ensure:
- Predictable entity lifecycles
- Permission enforcement
- Audit trails
- Workflow validation

---

## 1. ContentItem State Machine

### States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `idea` | Content conceived, not yet planned | No |
| `planned` | Approved for production | No |
| `brief_created` | Editor has defined scope | No |
| `draft` | Writer has produced initial draft | No |
| `in_editorial_review` | Editor is reviewing | No |
| `needs_changes` | Editor requests improvements | No |
| `approved` | Editorial approval complete | No |
| `scheduled` | Ready for deployment | No |
| `published` | Live on website | No |
| `archived` | Retired content | Yes |

### Transitions

| From | To | Event | Allowed Actors |
|------|-----|-------|----------------|
| `idea` | `planned` | `topic.accepted` | ChiefEditor, CEO |
| `planned` | `brief_created` | `brief.created` | Editor |
| `brief_created` | `draft` | `writer.started` | Writer |
| `draft` | `in_editorial_review` | `submit_for_review` | Writer |
| `in_editorial_review` | `needs_changes` | `request_changes` | Editor |
| `in_editorial_review` | `approved` | `approve` | Editor, CEO |
| `needs_changes` | `draft` | `revisions_applied` | Writer |
| `approved` | `scheduled` | `ready_for_publish` | SEOSpecialist, EngineeringAgent |
| `scheduled` | `published` | `deploy_success` | EngineeringAgent |
| `published` | `archived` | `retire` | CEO |

### Forbidden Transitions

- **Draft → Published** (must go through review)
- **Needs Changes → Approved** (must return to draft)
- **Published → Draft** (cannot unpublish directly, must archive first)

### Invariants

1. Content in `in_editorial_review` must have an associated Review record
2. Content cannot be `published` without `approved` status first
3. Only CEO can transition to `archived`
4. Writers cannot approve their own content

---

## 2. Task State Machine

### States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `planned` | Task created, not yet started | No |
| `in_progress` | Agent actively working on task | No |
| `blocked` | Task cannot proceed (missing dependencies, errors) | No |
| `completed` | Task finished successfully | Yes |
| `cancelled` | Task abandoned | Yes |

### Transitions

| From | To | Event | Allowed Actors |
|------|-----|-------|----------------|
| `planned` | `in_progress` | `agent.accepts` | Assigned Agent |
| `in_progress` | `blocked` | `error` | Assigned Agent |
| `blocked` | `in_progress` | `unblock` | Assigned Agent, TechnicalLead |
| `in_progress` | `completed` | `finish` | Assigned Agent |
| `planned` | `cancelled` | `cancel` | CEO, ChiefEditor |
| `in_progress` | `cancelled` | `cancel` | CEO |

### Invariants

1. Only the assigned agent can transition from `planned` to `in_progress`
2. Tasks in `blocked` state must have a `notes` field explaining the blocker
3. Completed tasks are immutable
4. A task cannot be `completed` if its related ContentItem is `archived`

---

## 3. Review State Machine

### States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `pending` | Review created, awaiting action | No |
| `completed` | Review decision made | No |
| `acknowledged` | Original author has seen the feedback | Yes |

### Transitions

| From | To | Event | Allowed Actors |
|------|-----|-------|----------------|
| `pending` | `completed` | `decision_made` | Reviewer |
| `completed` | `acknowledged` | `author_acknowledged` | Original Author |

### Invariants

1. A Review can only exist for ContentItem in `in_editorial_review` state
2. Reviewer cannot be the same as the content author
3. Review result must be one of: `approved`, `needs_changes`, `rejected`

---

## 4. QuestionTicket State Machine

### States

| State | Description | Terminal? |
|-------|-------------|-----------|
| `open` | Ticket created, awaiting response | No |
| `answered` | Response provided | No |
| `closed` | Ticket resolved | Yes |

### Transitions

| From | To | Event | Allowed Actors |
|------|-----|-------|----------------|
| `open` | `answered` | `answer_provided` | CEO, ChiefEditor, TechnicalLead |
| `answered` | `closed` | `agent_acknowledged` | Original Agent, CEO |
| `open` | `closed` | `invalid_ticket` | CEO |

### Invariants

1. Only the target (CEO, ChiefEditor, etc.) can provide an answer
2. Tickets in `answered` state must have `answer_body` populated
3. Closed tickets cannot be reopened (create new ticket instead)

---

## State Machine Rules

### Global Rules

1. **Determinism** — Given a current state and event, the next state is always deterministic
2. **Validation** — All transitions must be validated before execution
3. **Atomicity** — State transitions must be atomic (no partial updates)
4. **Events** — Every transition must emit a CloudEvent
5. **Audit** — All transitions must be logged with actor, timestamp, and reason

### Permission Enforcement

State machine transitions are subject to RBAC:
- **WriterAgent** can only transition content in states they own (draft, needs_changes)
- **EditorAgent** can transition content through review states
- **CEO** has override authority for all transitions

### Error Handling

If a transition is invalid:
1. **Reject** the transition
2. **Log** the attempted transition
3. **Return** a clear error message
4. **Do not** modify the entity state

---

## Implementation Notes

### XState Compatible

These state machines can be implemented using XState or similar libraries:

```typescript
const contentItemMachine = createMachine({
  id: 'contentItem',
  initial: 'idea',
  states: {
    idea: { on: { TOPIC_ACCEPTED: 'planned' } },
    planned: { on: { BRIEF_CREATED: 'brief_created' } },
    // ...
  }
})
```

### Database Constraints

State transitions should be enforced at multiple levels:
1. **Application layer** — Primary validation
2. **Database CHECK constraints** — Safety net
3. **Triggers** — Audit logging

### Transition History

Consider maintaining a `state_transitions` table for audit:

```sql
CREATE TABLE state_transitions (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(50),
  entity_id UUID,
  from_state VARCHAR(50),
  to_state VARCHAR(50),
  event VARCHAR(100),
  actor_id UUID,
  created_at TIMESTAMP
);
```

---

## Visualization

### ContentItem Lifecycle

```
idea → planned → brief_created → draft
                                    ↓
                               in_editorial_review
                                 /     |      \
                        needs_changes  approved  (rejected)
                              ↓          ↓
                            draft    scheduled → published → archived
```

### Task Lifecycle

```
planned → in_progress → completed
            ↓
         blocked ←┘

(cancelled can happen from planned or in_progress)
```

### Review Lifecycle

```
pending → completed → acknowledged
```

### QuestionTicket Lifecycle

```
open → answered → closed
  ↓
closed (invalid)
```

---

**These state machines are the canonical lifecycle definitions for agent.press.**
