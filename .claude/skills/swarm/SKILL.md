---
name: swarm
description: Developer skill for maintaining and extending the swarm.press autonomous publishing system. Use when working on backend code, agents, workflows, database schema, or debugging infrastructure.
---

# swarm.press Developer Guide

You are helping a developer maintain and extend swarm.press, a fully autonomous virtual publishing house operated by intelligent agents with human oversight.

---

## The Fundamental Architecture: Two Systems of Record

**This is the most important concept to understand.** swarm.press separates content from operational metadata into two distinct systems:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         swarm.press ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   CONTENT (Git Submodule)              METADATA (PostgreSQL)                │
│   ─────────────────────────            ─────────────────────                │
│   cinqueterre.travel/                  swarm.press database                 │
│   ├── content/                         ├── agents                           │
│   │   ├── pages/*.json                 ├── tasks                            │
│   │   ├── collections/*.json           ├── reviews                          │
│   │   ├── config/*.json                ├── content_items (refs only)        │
│   │   └── blog/*.json                  ├── editorial_tasks                  │
│   └── (separate Git repo)              ├── websites                         │
│                                        ├── state_audit_log                  │
│   Source of truth for:                 └── question_tickets                 │
│   • Actual page content                                                     │
│   • Village configurations             Source of truth for:                 │
│   • Collection data                    • Workflow state                     │
│   • Blog articles                      • Agent activities                   │
│   • Editorial voice configs            • Task assignments                   │
│                                        • Review history                     │
│                                        • State transitions                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Separation?

| Benefit | Explanation |
|---------|-------------|
| **Version Control** | Content changes tracked in Git with full history, diffs, and rollback |
| **Agent Collaboration** | Agents write JSON to Git, humans review via Pull Requests |
| **Theme Decoupling** | Same content repository can power different site themes |
| **Independent Scaling** | Content is static files; metadata is operational database |
| **Clear Ownership** | Content owned by editorial; metadata owned by system |

### How They Connect

1. **Website record** in PostgreSQL points to a Git submodule (e.g., `cinqueterre.travel/`)
2. **Agents** read content from Git, write changes back as commits
3. **PRs** are created for content changes, triggering review workflows
4. **PostgreSQL** tracks workflow state, but actual content lives in Git
5. **Site Builder** reads from Git submodule to generate the static site

### Key Implication for Development

When building features:
- **Content operations** → Read/write to Git submodule, create PRs
- **Workflow operations** → Read/write to PostgreSQL
- **Never mix them** → Don't store content in PostgreSQL or workflow state in Git

---

## Core Philosophy

1. **Spec-Driven Development** - Implementation follows specification, never the reverse
2. **Schema is Sacred** - `packages/backend/src/db/migrations/000_schema.sql` is the SINGLE SOURCE OF TRUTH
3. **Agents Are Employees** - Each agent has roles, capabilities, constraints, and escalation rules
4. **Workflows Are BPMN 2.0** - All processes are explicit, auditable, and executable
5. **No Silent Magic** - Every action produces a Task, Event, State Transition, or Review
6. **CEO Has Final Authority** - Human oversight for high-risk decisions

---

## Critical Rules (NEVER Break These)

| Rule | Description |
|------|-------------|
| Never skip workflows | All content must go through the full BPMN process |
| Never bypass state machines | All transitions must be validated |
| Never let agents act outside their role | Enforce RBAC strictly |
| Always emit events | Every significant action produces a CloudEvent |
| Always use QuestionTickets for escalation | No informal CEO pings |
| Agents are stateless | All state goes to PostgreSQL |
| Temporal calls agents synchronously | Not event-driven |
| Content is JSON blocks | Not plain Markdown, not MDX |
| Spec is the source of truth | Implementation follows spec |
| CEO has final authority | No agent can override CEO decisions |

---

## Architecture Quick Reference

### Technology Stack

| Layer | Technology |
|-------|------------|
| Agent Runtime | Claude Agent SDK |
| Workflow Engine | Temporal.io |
| Event Bus | NATS + JetStream |
| Database | PostgreSQL |
| Content Storage | PostgreSQL + S3/Cloudflare R2 |
| Website Generator | Astro |
| Monorepo | Turborepo + pnpm |
| Admin Dashboard | Astro + React + shadcn/ui |
| Authentication | GitHub OAuth |

### Package Structure

```
swarm-press/
├── packages/
│   ├── backend/          # API server, PostgreSQL, tRPC routers
│   ├── workflows/        # Temporal.io workflows
│   ├── agents/           # Claude Agent SDK implementations
│   ├── shared/           # Types, schemas, utilities
│   ├── site-builder/     # Astro website generation
│   ├── event-bus/        # NATS/CloudEvents
│   ├── github-integration/  # GitHub collaboration
│   └── cli/              # Operator CLI
├── apps/
│   ├── admin/            # Admin Dashboard
│   └── dashboard/        # CEO Dashboard
├── scripts/              # Bootstrap, seed, test scripts
├── specs/                # Authoritative specifications
└── domain/               # JSON Schema, BPMN diagrams
```

### Key Files Reference

| Resource | Path |
|----------|------|
| **Master Schema** | `packages/backend/src/db/migrations/000_schema.sql` |
| **Full Specification** | `specs/specs.md` |
| **Block Types (60+)** | `packages/shared/src/content/blocks.ts` |
| **Collection Schemas** | `packages/shared/src/content/collections/` |
| **API Routers** | `packages/backend/src/api/routers/` |
| **Agents** | `packages/agents/src/` |
| **Workflows** | `packages/workflows/src/workflows/` |
| **State Machines** | `packages/shared/src/state-machines/` |
| **Cinque Terre Theme** | `packages/site-builder/src/themes/cinque-terre/` |

---

## Common Development Commands

### Setup & Infrastructure

```bash
# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL, NATS, Temporal)
docker compose up -d

# Bootstrap system
tsx scripts/bootstrap.ts

# Seed sample data
tsx scripts/seed.ts

# Reset database
tsx scripts/clear.ts
```

### Running Services

```bash
# Run all services
pnpm dev

# Individual services
pnpm --filter @swarm-press/backend dev      # API server (localhost:3000)
pnpm --filter @swarm-press/workflows dev    # Temporal worker
pnpm --filter @swarm-press/admin dev        # Admin dashboard (localhost:4321)
```

### Building & Testing

```bash
# Build all packages
pnpm build

# Run end-to-end tests
tsx scripts/test-e2e.ts

# Type checking
pnpm typecheck
```

### Service URLs

| Service | URL |
|---------|-----|
| API Server | http://localhost:3000 |
| Admin Dashboard | http://localhost:4321 |
| Temporal UI | http://localhost:8233 |
| NATS Monitoring | http://localhost:8222 |

---

## Debugging Guide

### Database Issues

```bash
# Connect to PostgreSQL
docker exec -it swarm-press-postgres psql -U postgres -d swarm_press

# Check table state
SELECT * FROM content_items WHERE status = 'in_editorial_review';
SELECT * FROM state_audit_log ORDER BY created_at DESC LIMIT 10;
```

### Temporal Issues

1. Open Temporal UI at http://localhost:8233
2. Check workflow history for failures
3. Look for activity timeouts or retries

```bash
# Check Temporal worker logs
pnpm --filter @swarm-press/workflows dev 2>&1 | grep -i error
```

### Agent Issues

- Agents are stateless - check database for state
- Look at `agent_activities` table for activity log
- Check `question_tickets` for escalations

### Event Bus Issues

```bash
# Check NATS connection
curl http://localhost:8222/varz

# Monitor events
nats sub "swarm.>" --server nats://localhost:4222
```

---

## Adding New Features

### New Agent Checklist

1. Create agent directory: `packages/agents/src/{agent-name}/`
2. Implement agent class extending base agent
3. Define capabilities in spec (`specs/specs.md`)
4. Add to agent factory (`packages/agents/src/base/factory.ts`)
5. Register in database (`agents` table)
6. Create Temporal activities for agent invocation
7. Add tests

### New tRPC Router Checklist

1. Create router file: `packages/backend/src/api/routers/{name}.router.ts`
2. Define procedures with Zod validation
3. Export from `packages/backend/src/api/routers/index.ts`
4. Add to main router in `server.ts`
5. Update types in `packages/shared/src/types/`

### New Temporal Workflow Checklist

1. Create workflow: `packages/workflows/src/workflows/{name}.workflow.ts`
2. Define activities in `packages/workflows/src/activities/`
3. Register workflow with worker
4. Add CloudEvents for state transitions
5. Document in BPMN (`domain/workflows/bpmn/`)

### New Block Type Checklist

1. Add Zod schema to `packages/shared/src/content/blocks.ts`
2. Create Astro component in `packages/site-builder/src/components/blocks/`
3. Add to theme's ContentRenderer
4. Update `agent-schemas.json` for LLM documentation
5. Add examples to writer prompt

---

## State Machine Reference

### ContentItem States

```
draft → in_editorial_review → approved → published
                ↓                ↓
         needs_changes      rejected
                ↓
              draft
```

### Valid Transitions

| From | To | Actor |
|------|----|-------|
| draft | in_editorial_review | WriterAgent |
| in_editorial_review | approved | EditorAgent |
| in_editorial_review | needs_changes | EditorAgent |
| in_editorial_review | rejected | EditorAgent |
| needs_changes | draft | WriterAgent |
| approved | published | EngineeringAgent |

### State Transition Code Pattern

```typescript
// Always validate transitions
const canTransition = stateMachine.validate({
  from: 'draft',
  to: 'in_editorial_review',
  actor: 'WriterAgent',
  contentId: '123'
});

if (!canTransition) {
  throw new Error('Invalid state transition');
}

// Update DB + emit event
await db.contentItems.updateStatus('123', 'in_editorial_review');
await eventBus.publish('content.submittedForReview', { id: '123' });
```

---

## Prompt Management (3-Level System)

| Level | Table | Purpose |
|-------|-------|---------|
| 1 | `company_prompt_templates` | Baseline prompts |
| 2 | `website_prompt_templates` | Brand-specific overrides |
| 3 | `agent_prompt_bindings` | Individual agent assignments |

### Prompt Resolution Order

1. Check `agent_prompt_bindings` for specific binding
2. Fall back to `website_prompt_templates` for brand
3. Fall back to `company_prompt_templates` for baseline

---

## Event Categories

| Category | Events |
|----------|--------|
| Content | content.created, content.submittedForReview, content.approved, content.published |
| Review | review.completed, review.needsChanges |
| Tasks | task.created, task.completed |
| Tickets | ticket.created, ticket.answered, ticket.closed |
| Publishing | deploy.started, deploy.success, deploy.failed |

---

## Quick Diagnostics

When debugging issues, check in this order:

- [ ] Is Docker running? (`docker compose ps`)
- [ ] Is the database connected? (check `backend` logs)
- [ ] Is Temporal worker running? (check http://localhost:8233)
- [ ] Are events flowing? (check NATS monitoring)
- [ ] Is the state machine valid? (check `state_audit_log`)
- [ ] Are agents responding? (check `agent_activities`)
- [ ] Are there pending escalations? (check `question_tickets`)

---

## Key Specifications to Read

| Spec | When to Read |
|------|--------------|
| `specs/specs.md` | Understanding overall system design |
| `specs/idea.md` | GitHub integration patterns |
| `specs/sitemap-component.md` | Agentic sitemap features |
| `specs/agentic_editorial_planning_spec.md` | Editorial workflow |
| `specs/collections_binaries.md` | Collections and media |
| `specs/prompting.md` | Prompt engineering guidelines |

---

## Content Architecture Pattern

Content is separate from operational metadata:

| Type | Location | Purpose |
|------|----------|---------|
| Metadata | PostgreSQL | Agents, workflows, state, tasks |
| Content | Git Submodule (JSON) | Pages, collections, configs |
| Media | S3/Cloudflare R2 | Images, videos, binaries |

### Content as JSON Blocks (Not Markdown!)

```typescript
// ContentItem.body is structured JSON
type ContentBody = Block[]

type Block =
  | { type: 'paragraph', markdown: string }
  | { type: 'hero', title: string, subtitle?: string }
  | { type: 'image', src: string, caption: string, alt: string }
  | { type: 'faq', items: Array<{ q: string, a: string }> }
```

---

**Remember:** swarm.press is not just AI content generation. It's a fully structured, autonomous publishing organization with real workflows, real governance, and real accountability.
