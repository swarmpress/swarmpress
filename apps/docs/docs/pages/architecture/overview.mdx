# Architecture Overview

> **Last Updated:** 2025-11-26
> **Status:** Current

swarm.press is a fully autonomous virtual publishing house operated by intelligent agents with human oversight.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Human Layer                               │
│  CEO Dashboard │ Admin UI │ GitHub PRs/Issues │ Question Tickets │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                      API Layer (tRPC)                           │
│         Express Server │ 23+ Routers │ GitHub Webhooks          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                    Orchestration Layer                          │
│  Temporal Workflows │ State Machine │ Event Bus (NATS)          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                      Agent Layer                                │
│    WriterAgent │ EditorAgent │ EngineeringAgent │ CEOAssistant  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                     Storage Layer                               │
│         PostgreSQL │ S3/R2 (Media) │ GitHub (Content)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Agent System
Four autonomous Claude agents with specific roles:

| Agent | Department | Capabilities |
|-------|-----------|--------------|
| **WriterAgent** | Writers Room | research_topic, write_draft, revise_draft, submit_for_review |
| **EditorAgent** | Editorial | review_content, request_changes, approve_content, reject_content |
| **EngineeringAgent** | Engineering | prepare_build, validate_assets, publish_site |
| **CEOAssistantAgent** | Governance | summarize_tickets, organize_escalations, notify_ceo |

Agents are **stateless** - all state lives in PostgreSQL.

### 2. Workflow Engine (Temporal.io)
Three primary workflows orchestrate agent collaboration:

- **Content Production** - idea → draft → review → publish
- **Editorial Review** - submit → approve/reject → revise loop
- **Publishing** - build → validate → deploy

### 3. Event Bus (NATS + CloudEvents)
Event-driven communication with CloudEvents v1.0:
- `content.*` - content lifecycle events
- `review.*` - editorial review events
- `task.*` - workflow task events
- `deploy.*` - publishing events

### 4. State Machine
Enforces valid state transitions with audit logging:
- ContentItem: idea → draft → in_review → approved → published
- Task: pending → in_progress → completed
- Review: pending → approved | rejected | needs_changes

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Claude Agent SDK |
| Workflow Engine | Temporal.io |
| Event Bus | NATS JetStream |
| Database | PostgreSQL |
| API | Express + tRPC |
| Admin Dashboard | Astro + React + shadcn/ui |
| Site Builder | Astro (static generation) |
| Collaboration | GitHub (PRs, Issues, Webhooks) |

---

## Key Patterns

### Spec-Driven Development
- Specifications in `/specs/` are authoritative
- Implementation follows spec, never the reverse
- Changes require spec updates first

### Content as JSON Blocks
Content is structured JSON, not plain Markdown:
```typescript
type ContentBody = Block[]
type Block =
  | { type: 'paragraph', markdown: string }
  | { type: 'hero', title: string, subtitle?: string }
  | { type: 'image', src: string, caption: string }
  | { type: 'faq', items: Array<{ q: string, a: string }> }
```

### Three-Level Prompt System
1. **Company Level** - Baseline prompts
2. **Website Level** - Brand-specific overrides
3. **Agent Level** - Individual agent assignments

---

## Monorepo Structure

```
swarm-press/
├── packages/
│   ├── backend/          # API server, repositories, services
│   ├── agents/           # Claude Agent SDK implementations
│   ├── workflows/        # Temporal.io workflows
│   ├── shared/           # Types, schemas, utilities
│   ├── event-bus/        # NATS integration
│   ├── site-builder/     # Astro generator
│   └── github-integration/ # GitHub collaboration
├── apps/
│   ├── admin/            # Admin dashboard (port 3002)
│   └── dashboard/        # CEO dashboard (port 3001)
└── specs/                # Authoritative specifications
```

---

## Related Documentation

- [Multi-Tenant Architecture](./multi-tenant.md) - Tenant hierarchy
- [Editorial Planning](./editorial-planning.md) - Content workflow
- [Sitemap System](./sitemap-system.md) - Page management
- [GitHub Integration](./github-integration.md) - Collaboration features
- [API Reference](../reference/api.md) - Complete API docs
