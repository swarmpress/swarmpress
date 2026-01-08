# Architecture Overview

> **Last Updated:** 2026-01-08
> **Status:** Current - Cinque Terre Reference Implementation

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
│  PostgreSQL (Metadata) │ Git Submodule (Content) │ S3/R2 (Media)│
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
Content is structured JSON with 60+ block types and Zod validation:

| Category | Count | Examples |
|----------|-------|----------|
| Core | 10 | paragraph, heading, hero, image, gallery |
| Marketing | 20 | hero-section, feature-section, pricing-section |
| Cinque Terre Theme | 15 | village-selector, places-to-stay, eat-drink |
| Editorial | 5 | editorial-hero, editor-note, closing-note |

```typescript
// All blocks validated with Zod schemas (packages/shared/src/content/blocks.ts)
type ContentBody = Block[]
type Block =
  | { type: 'paragraph', markdown: string }
  | { type: 'hero', title: string, subtitle?: string }
  | { type: 'editorial-hero', title: LocalizedString, badge?: string }
  | { type: 'village-selector', villages: VillageItem[] }
  // ... 60+ more block types
```

### Content Architecture Pattern
swarm.press separates **operational metadata** from **content**:

| Type | Location | Purpose |
|------|----------|---------|
| **Metadata** | PostgreSQL | Agents, workflows, state, tasks |
| **Content** | Git Submodule | JSON pages, collections, config |
| **Media** | S3/Cloudflare R2 | Images, videos, binaries |

This enables Git-based version control, PR-based review, and theme decoupling.
See [Content Architecture](./content-architecture.md) for details.

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
│   ├── shared/           # Types, schemas, 60+ block Zod schemas
│   ├── event-bus/        # NATS integration
│   ├── site-builder/     # Astro generator
│   │   └── src/themes/   # Site-specific themes
│   │       └── cinque-terre/  # Reference implementation
│   └── github-integration/ # GitHub collaboration
├── apps/
│   ├── admin/            # Admin dashboard (port 3002)
│   └── dashboard/        # CEO dashboard (port 3001)
├── cinqueterre.travel/   # Content submodule (Git)
│   └── content/
│       ├── config/       # Agent configuration files
│       ├── pages/        # Page content (JSON blocks)
│       └── collections/  # Collection data
└── specs/                # Authoritative specifications
```

---

## Related Documentation

- [Content Architecture](./content-architecture.md) - Metadata vs content separation
- [Multi-Tenant Architecture](./multi-tenant.md) - Tenant hierarchy
- [Editorial Planning](./editorial-planning.md) - Content workflow
- [Sitemap System](./sitemap-system.md) - Page management
- [GitHub Integration](./github-integration.md) - Collaboration features
- [API Reference](../reference/api.md) - Complete API docs
- [Theme Development](../guides/theme-development.md) - Creating themes
