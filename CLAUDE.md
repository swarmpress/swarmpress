# swarm.press — Claude Development Guide

> **Last Updated:** 2026-05-11
> **Status:** Production Ready with Autonomous Scheduling
> **Spec Version:** 1.1
> **Schema Version:** 1.2.0 (46 block types, 11 agents, 11 workflows)
> **Storage Contract:** repo-canonical — page/collection content lives in
> the site's GitHub repo; Postgres holds only operational metadata.

---

## 📖 What is swarm.press?

**swarm.press** is a fully autonomous virtual publishing house operated by intelligent agents with human oversight.

It is **not** a generic content generator. It is a **structured organization** with:
- Departments (Editorial, Writers, SEO, Media, Engineering, Distribution, Governance)
- Roles and responsibilities (RBAC + RACI)
- Formal workflows (BPMN 2.0)
- State machines for entity lifecycles
- Event-driven communication (CloudEvents)
- A human CEO who approves high-risk decisions

**Think of it as:** A real media company where all employees are autonomous AI agents, following real-world publishing workflows.

---

## 🎯 Core Philosophy

### 1. **Spec-Driven Development**
- Implementation follows specification, never the reverse
- All changes must update the spec first
- See: `specs/specs.md` (full 2,300+ line specification)

### 2. **Schema is Sacred**
- **MASTER SCHEMA:** `packages/backend/src/db/migrations/000_schema.sql`
- This is the SINGLE SOURCE OF TRUTH for the database
- Before adding new features, READ THIS FILE to understand the current schema
- When adding features, UPDATE THIS FILE (not create new migrations)
- All `CREATE TABLE` / `CREATE INDEX` use `IF NOT EXISTS`; triggers use `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` so the file is replayable
- New objects from concurrent worktrees must be appended **after** the `-- AUDIT TRAILER` marker at the end of the file, each in its own `BEGIN/COMMIT` block, to avoid merge conflicts on the previous COMMIT
- The schema is applied by `scripts/bootstrap.ts` via the `pg` library (no `psql` shell-out), reading every `*.sql` file in `packages/backend/src/db/migrations/` lexicographically
- **Content (page bodies, collection items) lives in the site's GitHub repo, NOT in Postgres.** Postgres only holds operational metadata (tasks, schedules, agent activity, audit log, outbox, prompt templates, registry rows). The columns `content_items.body` and `collection_items.data` are DEPRECATED — see the schema's repo-canonical migration block at the bottom of `000_schema.sql`.

### 3. **Agents Are Employees**
Each agent has:
- A role (Writer, Editor, SEO Specialist, etc.)
- Capabilities (what it can do)
- Constraints (what it cannot do)
- Escalation rules (when to ask for help)
- Tools (functions it can call)

### 4. **Workflows Are BPMN 2.0**
All processes are explicit, auditable, and executable:
- Content Production: idea → draft → review → publish
- Editorial Review: submit → approve/reject → revise loop
- Publishing: build → validate → deploy

### 5. **No Silent Magic**
Every action produces:
- A Task
- An Event (CloudEvents)
- A State Transition
- A Review or QuestionTicket

### 6. **CEO Has Final Authority**
- Human oversight for high-risk decisions
- Agents escalate via QuestionTickets
- No agent can bypass governance

---

## 🏗️ Architecture Decisions (Authoritative)

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Agent Runtime** | Claude Agent SDK | Stateless agents with tools + delegation |
| **Workflow Engine** | Temporal.io | Long-running, fault-tolerant orchestration |
| **Event Bus** | NATS + JetStream | CloudEvents, simple, reliable |
| **Database** | PostgreSQL | Relational model + JSONB for content |
| **Content Storage** | PostgreSQL + S3/Cloudflare R2 | Metadata in DB, media in object storage |
| **Website Generator** | Astro | Static/hybrid sites, component-based |
| **Monorepo** | Turborepo + pnpm | Shared types, schemas, unified builds |
| **Admin Dashboard** | Astro + React + shadcn/ui | Web UI for content management |
| **Collaboration** | GitHub | PRs, Issues, webhooks for content review |
| **Authentication** | GitHub OAuth | User authentication via GitHub |

### Key Patterns

#### **Temporal ↔ Agents (Synchronous)**
```typescript
// Temporal Workflow
export async function contentProductionWorkflow(briefId: string) {
  // Step 1: Writer drafts content
  const draft = await callAgentActivity('WriterAgent', 'write_draft', { briefId })

  // Step 2: Editor reviews
  const review = await callAgentActivity('EditorAgent', 'review_content', { draft })

  if (review.result === 'needs_changes') {
    // Loop back to writer
    return await contentProductionWorkflow(briefId)
  }

  // Step 3: Publish
  await callAgentActivity('EngineeringAgent', 'publish_site', { draft })
}
```

#### **Agents Are Stateless**
```typescript
// ❌ BAD: Agent stores state internally
class WriterAgent {
  private drafts = new Map() // NO!
  private conversationHistory: Message[] = [] // NO! leaks across tasks
}

// ✅ GOOD: All state in PostgreSQL; conversation is per-call locals
class WriterAgent {
  async writeDraft(brief: Brief) {
    const conversationHistory: Message[] = [] // local to this call
    const draft = await callClaude(...)
    await db.contentItems.insert(draft) // State goes to DB
    await eventBus.publish('content.created', { id: draft.id })
    return draft
  }
}
```

`AgentFactory.getAgent()` always returns a **fresh instance** — there is no
agent cache. The `BaseAgent` class holds no per-call state; conversation
history is scoped to the `execute()` call.

#### **Content as JSON Blocks**
```typescript
// ContentItem.body is structured JSON, not plain Markdown
type ContentBody = Block[]

type Block =
  | { type: 'paragraph', markdown: string }
  | { type: 'hero', title: string, subtitle?: string }
  | { type: 'image', src: string, caption: string, alt: string }
  | { type: 'faq', items: Array<{ q: string, a: string }> }

// Why? LLM-friendly, flexible, component-ready
```

**Renderers must NOT parse Markdown at render time.** Inline emphasis
(bold, italic) belongs in structured sub-blocks, not regex on paragraph
text. A coverage test at `packages/site-builder/test/block-coverage.test.ts`
asserts every Zod-registered block type has a corresponding renderer case
(currently 46/46).

#### **State Machines Enforce Transitions**
```typescript
// Before transitioning ContentItem state:
const canTransition = stateMachine.validate({
  from: 'draft',
  to: 'in_editorial_review',
  actor: 'WriterAgent',
  contentId: '123'
})

if (!canTransition) {
  throw new Error('Invalid state transition')
}

// Update DB + write event to outbox — same transaction
await stateMachineEngine.executeTransition({
  entityType: 'content_item',
  entityId: '123',
  to: 'in_editorial_review',
  expectedUpdatedAt: priorUpdatedAt, // optimistic lock
})
// OutboxWorker drains event_outbox to NATS asynchronously
```

#### **Content I/O via RepoClient**
All agent reads/writes of page or collection content go through `RepoClient`
(`packages/github-integration/src/repo-client.ts`):

```typescript
import { getRepoClient } from '@swarm-press/github-integration'

const repo = await getRepoClient(websiteId)
const page = await repo.getPageByPath('content/pages/en/riomaggiore.json')
await repo.savePageByPath('content/pages/en/riomaggiore.json', updatedPage, message)
```

`getRepoClient(websiteId)` reads
`websites.{github_owner, github_repo, github_access_token}` from Postgres
and returns a memoized client per (websiteId, branch) tuple. Agents
NEVER touch Octokit directly. The Postgres columns
`content_items.body`, `collection_items.data` (and the
`collection_item_versions` table) are DEPRECATED and should not be read
or written by new code — page/collection JSON in the site repo is the
source of truth, with Git history as the version log.

#### **Transactional Outbox for CloudEvents**
The state-machine engine writes both the state change and the resulting
CloudEvent inside a single Postgres transaction:
- `state_audit_log` row + entity update + `event_outbox` insert all commit together
- `OutboxWorker` (`packages/backend/src/services/outbox-worker.service.ts`)
  polls `event_outbox` and publishes to NATS with at-least-once delivery
- Optimistic concurrency: `executeTransition()` accepts `expectedUpdatedAt`
  and throws `StateTransitionConflict` if the row was modified concurrently
- The worker is NOT auto-started; bootstrap your application with
  `import { outboxWorker } from '@swarm-press/backend'; outboxWorker.start()`

#### **Temporal Workflow Determinism**
Code under `packages/workflows/src/workflows/**` runs inside the Temporal
replay sandbox and must be deterministic:
- ❌ `Date.now()`, `Math.random()`, `crypto.randomUUID()`, direct `fetch()`
- ✅ Use the activities in `packages/workflows/src/activities/determinism.ts`:
  `generateId(prefix)`, `measureDuration(startMs)`, `getCurrentTimestamp()`
- ✅ Activities (under `src/activities/`) ARE allowed to be non-deterministic
- An ESLint `no-restricted-syntax` rule scoped to `src/workflows/**`
  enforces this at lint time (see root `.eslintrc.json`)
- All `proxyActivities` retry policies set `initialInterval`,
  `backoffCoefficient: 2`, and `maximumInterval` — no instant retry storms

---

## 📦 Content Architecture Pattern (repo-canonical)

After the repo-canonical migration, the **site's GitHub repository is the
canonical store of record for content**. Postgres holds only operational
metadata. Each website is one repo with its own GitHub Actions deploy
workflow — multi-site is "more rows in `websites`," each with its own
repo.

### Storage Separation
| Type | Location | Purpose |
|------|----------|---------|
| **Operational metadata** | PostgreSQL | Agents, workflows, state, tasks, reviews, schedules, audit log, outbox, prompt templates, registry rows |
| **Content (canonical)** | Site GitHub repo (JSON) | Pages, collections, site config, agent overrides — **single source of truth** |
| **Media** | S3 / Cloudflare R2 | Images, videos, binary assets |

### Why repo-canonical?
- **Version Control**: full Git history per change, native diff/blame/PR tooling.
- **Agent Collaboration**: agents commit JSON; humans review PRs; same surface as human contributors.
- **Theme Decoupling**: same JSON content, different theme renderers.
- **Multi-language**: `LocalizedString` JSON shape, validated at write.
- **Deploy isolation**: each site repo's `.github/workflows/deploy.yml`
  owns its own build + deploy. Platform never builds or pushes to
  gh-pages itself.
- **No drift**: with one source of truth, the dual-write hazards we
  fought during the audit cannot recur.

### Per-Site Repository Structure
```
{site}.travel/                     # one repo per website
├── .github/
│   └── workflows/
│       └── deploy.yml             # CANONICAL build + deploy (Actions)
├── content/
│   ├── site.json                  # site-wide config (theme, etc.)
│   ├── config/                    # agent overrides
│   │   ├── agent-schemas.json
│   │   ├── writer-prompt.json
│   │   ├── collection-research.json
│   │   ├── blog-workflow.json
│   │   ├── media-guidelines.json
│   │   └── villages/{village}.json
│   ├── pages/                     # page content (JSON blocks)
│   │   ├── {lang}/                # multi-language routing
│   │   │   ├── index.json
│   │   │   └── {village}.json
│   └── collections/               # per-village arrays
│       ├── restaurants/{village}.json
│       ├── accommodations/{village}.json
│       └── hikes/{village}.json
└── (theme is consumed from the monorepo via the deploy workflow;
   the repo itself does not vendor the theme)
```

Page JSON shape (enforced live):
`{ id, slug:LocalizedString, title:LocalizedString, page_type, seo, body[], status, timestamps }`.
Collection items are stored as **per-village arrays**, NOT one file per
item. `LocalizedString` requires `en` (already enforced post-audit).

### Agent Workflow with Content
```
┌─────────────────────────────────────────────────────────────┐
│  AGENT WORKFLOW (repo-canonical)                            │
├─────────────────────────────────────────────────────────────┤
│  1. WriterAgent receives task from Temporal workflow        │
│  2. Agent reads brief + collections via RepoClient          │
│  3. Agent commits page JSON to draft branch via RepoClient  │
│  4. Agent opens PR on the site repo (drafts/ → main)        │
│  5. EditorAgent reviews PR; approve = merge via RepoClient  │
│  6. Site repo's .github/workflows/deploy.yml fires on merge │
│  7. GitHub Actions builds Astro from monorepo theme         │
│  8. actions/deploy-pages@v4 deploys to live URL             │
│  9. deployment_status webhook → platform records 'deployed' │
└─────────────────────────────────────────────────────────────┘
```

### Build & Deploy
The platform no longer performs local Astro builds or pushes to
gh-pages. Build+deploy is owned by each site repo's own GitHub Actions
workflow (`.github/workflows/deploy.yml`), which:

1. Checks out the site repo (which holds the canonical content JSON).
2. Pulls the Astro theme from the monorepo.
3. Builds with `CONTENT_DIR=content/pages`.
4. Deploys via `actions/deploy-pages@v4`.

Once GitHub fires the `deployment_status.success` webhook, the platform
records the transition in `state_audit_log` and the
`publishingWorkflow` resumes its "wait for deploy" activity.

The retired pieces (kept for backward compat as deprecated paths):
- `EngineeringAgent.{validate_content, build_site, deploy_site, publish_website, build_from_github}` tools
- `packages/site-builder/src/generator/{build,deploy}.ts` (local Astro
  build + Octokit gh-pages push — the "parallel deploy nobody saw")
- `github.deployToPages` tRPC mutation
- `publishingWorkflow`'s former engineering-build / engineering-deploy
  steps (replaced by `waitForDeploymentActivity`)

---

## 🏝️ Cinque Terre Reference Implementation

The Cinque Terre travel website serves as the **reference implementation** for the agentic content system.

### Key Components
| Component | Location |
|-----------|----------|
| **Theme** | `packages/site-builder/src/themes/cinque-terre/` |
| **Content Submodule** | `cinqueterre.travel/` |
| **Agent Configs** | `cinqueterre.travel/content/config/` |
| **Village Data** | `cinqueterre.travel/content/config/villages/` |

### Multi-Language Support (LocalizedString)
```typescript
// All user-facing content uses this strict shape (Zod-validated):
type LocalizedString = {
  en: string  // English (REQUIRED — also the fallback locale)
  de?: string // German
  fr?: string // French
  it?: string // Italian
}

// Always read via the shared helper — never `value[locale] || value.en`:
import { getLocalizedValue } from '@swarm-press/shared'
const title = getLocalizedValue(page.title, locale)  // falls back to .en

// Example usage in village JSON
{
  "title": {
    "en": "Riomaggiore",
    "de": "Riomaggiore",
    "fr": "Riomaggiore",
    "it": "Riomaggiore"
  }
}
```

The previous loose `string | Record<string, string>` shape silently broke
consumers that assumed an object. The schema is now strict and `en` is
required at the type level.

### Theme Features
- **Coastal Spine Navigation**: Village-centric geographic navigation
- **5 Villages**: Riomaggiore, Manarola, Corniglia, Vernazza, Monterosso
- **35+ Astro Components**: Editorial blocks, village content, collections
- **Dynamic Village Config**: JSON-based village data (weather, character, essentials)

> Note: the submodule's `build-all-pages.js` (vanilla JS HTML generator) is a
> legacy fallback; the live deploy uses the Astro theme via the submodule's
> `.github/workflows/deploy.yml`.

---

## 📂 Current Implementation Structure

```
swarm-press/
├── packages/
│   ├── backend/              # API server, PostgreSQL models, tRPC routers
│   │   ├── src/api/          # Express + tRPC API server
│   │   │   ├── routers/      # 15+ tRPC routers (content, task, ticket, etc.)
│   │   │   ├── server.ts     # Express app
│   │   │   └── webhooks.router.ts  # GitHub webhooks
│   │   ├── src/db/           # PostgreSQL repositories
│   │   │   ├── migrations/   # Schema (000_schema.sql)
│   │   │   ├── repositories/ # 12+ repositories
│   │   │   └── connection.ts # Database singleton
│   │   ├── src/services/     # Business logic services
│   │   │   ├── github.service.ts
│   │   │   ├── github-sync.service.ts
│   │   │   ├── media.service.ts
│   │   │   ├── prompt-resolver.service.ts
│   │   │   └── auth.service.ts
│   │   └── src/state-machine/ # State machine engine
│   ├── workflows/            # Temporal.io workflows
│   │   ├── src/workflows/    # 3 workflows
│   │   │   ├── content-production.workflow.ts
│   │   │   ├── editorial-review.workflow.ts
│   │   │   └── publishing.workflow.ts
│   │   ├── src/activities/   # Agent invocation activities
│   │   └── src/temporal/     # Temporal client & worker
│   ├── agents/               # Claude Agent SDK implementations
│   │   ├── src/writer/       # WriterAgent
│   │   ├── src/editor/       # EditorAgent
│   │   ├── src/engineering/  # EngineeringAgent
│   │   ├── src/ceo-assistant/ # CEOAssistantAgent
│   │   └── src/base/         # Agent factory & utilities
│   ├── shared/               # Shared types, schemas, utilities
│   │   ├── src/types/        # TypeScript types
│   │   ├── src/content/      # Block types & collections
│   │   │   ├── blocks.ts     # 60+ block types with Zod validation
│   │   │   └── collections/  # Event, POI, FAQ, News schemas
│   │   ├── src/state-machines/ # State machine definitions
│   │   ├── src/logging/      # Structured logging, error tracking
│   │   └── src/config/       # Environment config
│   ├── site-builder/         # Astro website generation
│   │   ├── src/components/   # Core block components (.astro)
│   │   │   └── blocks/       # Hero, Paragraph, FAQ, etc.
│   │   ├── src/generator/    # Build & deploy functions
│   │   ├── src/layouts/      # Base layouts
│   │   └── src/themes/       # Site-specific themes
│   │       └── cinque-terre/ # Reference implementation (35+ components)
│   ├── event-bus/            # NATS/CloudEvents integration
│   │   ├── src/publisher.ts  # Event publishing
│   │   ├── src/subscriber.ts # Event subscription
│   │   └── src/cloudevents.ts # CloudEvents helpers
│   ├── github-integration/   # GitHub collaboration layer
│   │   ├── src/client.ts     # GitHub API wrapper
│   │   ├── src/pull-requests.ts # PR operations
│   │   ├── src/issues.ts     # Issue operations
│   │   ├── src/webhooks.ts   # Webhook processing
│   │   └── src/sync.ts       # Bidirectional sync
│   └── experimental-cli/     # Operator CLI prototype (not integrated, see audit item 32)
├── apps/
│   ├── admin/                # Admin Dashboard (React + shadcn/ui)
│   │   ├── src/components/
│   │   │   ├── sitemap/      # Sitemap graph visualization
│   │   │   ├── editorial/    # Kanban board, Gantt, tasks
│   │   │   ├── blueprints/   # Blueprint editor
│   │   │   └── ui/           # shadcn/ui components
│   │   ├── src/pages/        # Astro pages
│   │   │   └── api/          # API routes
│   │   └── src/hooks/        # React hooks
│   └── dashboard/            # CEO Dashboard (minimal)
├── scripts/
│   ├── bootstrap.ts          # System initialization
│   ├── seed.ts               # Sample data
│   ├── clear.ts              # Reset database
│   ├── test-e2e.ts           # Real end-to-end test (Postgres + NATS + Temporal)
│   ├── test-workflow-mock.ts # Mocked unit-style workflow walk-through
│   └── README.md             # Index of all scripts
├── specs/
│   ├── specs.md              # Full specification (2,300+ lines)
│   ├── idea.md               # GitHub integration design
│   ├── sitemap-component.md  # Agentic sitemap features
│   ├── agentic_editorial_planning_spec.md # Editorial workflow
│   ├── prompting.md          # Prompt engineering
│   └── collections_binaries.md # Collections & media management
├── domain/
│   ├── schemas/              # JSON Schema files
│   └── workflows/bpmn/       # BPMN workflow diagrams
├── docker-compose.yml        # PostgreSQL, NATS, Temporal
├── turbo.json                # Turborepo build config
├── CLAUDE.md                 # This file
└── README.md                 # User-facing documentation
```

---

## 🗂️ Database Schema (Current State)

The master schema at `packages/backend/src/db/migrations/000_schema.sql` includes:

### Core Organizational Entities
- **companies** - Top-level organizations
- **departments** - Organizational units
- **roles** - Functions with permissions (JSONB)
- **agents** - AI employees with capabilities

### Website & Content Structure
- **websites** - Publication surfaces with GitHub integration
  - GitHub repo connection (owner, repo, installation_id, access_token)
  - GitHub Pages deployment (branch, path, custom domain, status)
  - `last_deployed_at` / `deployment_status` updated by the
    `deployment_status` webhook handler (WS4), not by the platform's
    own deploy code
- **pages** - Sitemap structure with agentic features
  - SEO profiles, internal links, suggestions, tasks (all JSONB)
  - Hierarchical structure (parent_id)
  - **Note:** there is no `pages.body` column; page block content lives
    in the site repo at `content/pages/{lang}/{slug}.json`, not in
    Postgres
- **content_blueprints** - Page templates
- **content_items** - Operational metadata for editorial tasks
  - `content_items.body` is **DEPRECATED** (nullable, no new writes) —
    page body JSON lives in the site repo. The row is now an ops handle
    (status, author, timestamps, metadata) for the editorial workflow.

### Editorial Planning System
- **editorial_tasks** - Content planning with SEO & linking metadata
- **task_phases** - Detailed phase tracking (research, outline, draft, etc.)

### Workflow & Collaboration
- **tasks** - General workflow tasks
- **reviews** - Editorial reviews
- **question_tickets** - Escalations to humans

### Agent Activities
- **agent_activities** - Activity log
- **suggestions** - AI-generated ideas

### Prompt Management (3-Level System)
- **company_prompt_templates** - Baseline prompts (Level 1)
- **website_prompt_templates** - Brand-specific overrides (Level 2)
- **agent_prompt_bindings** - Individual agent assignments (Level 3)
- **prompt_executions** - Performance tracking with quality metrics

### Analytics & Caching
- **sitemap_analytics_cache** - Cached metrics
- **graph_positions** - Visual editor positions
- **state_audit_log** - State machine transitions

---

## 🤖 Agent Specifications

### Core Agents (Implemented)

| Agent | Department | Capabilities |
|-------|-----------|--------------|
| **WriterAgent** | Writers Room | research_topic, write_draft, revise_draft, submit_for_review |
| **EditorAgent** | Editorial | review_content, request_changes, approve_content, reject_content, escalate_to_ceo |
| **EngineeringAgent** | Engineering | get_website_info, export_collection_to_github, import_collection_from_github, batch jobs (build/deploy tools DEPRECATED — see Build & Deploy section) |
| **CEOAssistantAgent** | Governance | summarize_tickets, organize_escalations, notify_ceo |

### Agent Location
```
packages/agents/src/
├── writer/
│   ├── index.ts
│   └── writer-agent.ts
├── editor/
│   ├── index.ts
│   └── editor-agent.ts
├── engineering/
│   ├── index.ts
│   └── engineering-agent.ts
├── ceo-assistant/
│   ├── index.ts
│   └── ceo-assistant-agent.ts
├── base/
│   ├── agent.ts          # Base agent class
│   ├── factory.ts        # Agent factory
│   └── utilities.ts      # Shared utilities
├── examples/
│   └── delegation-example.ts
└── index.ts
```

---

## 🔄 Workflows (Implemented)

### 3 Temporal Workflows

```
packages/workflows/src/workflows/
├── content-production.workflow.ts  # Full content lifecycle
├── editorial-review.workflow.ts    # Review & approval
├── publishing.workflow.ts          # Build & deploy
└── index.ts
```

### Content Production Workflow
```
1. CEO/Editor creates brief
2. WriterAgent drafts content
3. WriterAgent submits for review
4. EditorAgent reviews
   - needs_changes → back to step 2
   - rejected → END
   - approved → continue
5. SEO optimization (stubbed)
6. Media assets (stubbed)
7. EngineeringAgent prepares build
8. (Optional) CEO approves if high-risk
9. EngineeringAgent publishes
10. CloudEvent: content.published
```

---

## 📡 Events (CloudEvents)

### Event Bus Location
```
packages/event-bus/src/
├── publisher.ts       # Event publishing
├── subscriber.ts      # Event subscription
├── cloudevents.ts     # CloudEvents helpers
├── connection.ts      # NATS connection
└── index.ts
```

### Event Categories

| Category | Events |
|----------|--------|
| **Content** | content.created, content.submittedForReview, content.approved, content.published |
| **Review** | review.completed, review.needsChanges |
| **Tasks** | task.created, task.completed |
| **Tickets** | ticket.created, ticket.answered, ticket.closed |
| **Publishing** | deploy.started, deploy.success, deploy.failed |

---

## 🌐 GitHub Integration

### Features
- **Content Review via PRs** - All content goes through PR review
- **Tasks as Issues** - Editorial tasks synced to GitHub Issues
- **Question Tickets** - Escalations as Issues
- **Webhook Sync** - Bidirectional GitHub ↔ Database sync
- **OAuth Authentication** - Users authenticate via GitHub

### Implementation
```
packages/github-integration/src/
├── client.ts           # GitHub API wrapper (Octokit)
├── pull-requests.ts    # PR operations (create, update, merge)
├── issues.ts           # Issue operations
├── webhooks.ts         # Webhook processing
├── sync.ts             # Bidirectional sync logic
└── index.ts
```

### Website GitHub Fields (in schema)
```sql
github_repo_url TEXT,
github_owner TEXT,
github_repo TEXT,
github_installation_id TEXT,
github_access_token TEXT,
github_connected_at TIMESTAMPTZ,

-- GitHub Pages Deployment
github_pages_enabled BOOLEAN,
github_pages_url TEXT,
github_pages_branch TEXT,
github_pages_path TEXT,
github_pages_custom_domain TEXT,
last_deployed_at TIMESTAMPTZ,
deployment_status TEXT,
deployment_error TEXT
```

---

## 📚 Collections System

### Implemented Collections
```
packages/shared/src/content/collections/
├── event.ts      # EventSchema (Zod)
├── poi.ts        # POISchema (Points of Interest)
├── faq.ts        # FAQSchema
├── news.ts       # NewsSchema
├── registry.ts   # Collection registry
└── index.ts
```

### Database Tables
- **website_collections** - Per-website collection config (active)
- **collection_items** - Operational handle for collection records;
  `collection_items.data` is **DEPRECATED** (nullable, no new writes) —
  item content lives in the site repo at
  `content/collections/{type}/{village}.json` (per-village arrays)
- **collection_item_versions** - **DEPRECATED**, replaced by Git history
  on the site repo. Retained for backward compat; a follow-up cleanup
  PR may DROP the table once a data audit confirms it is unused.
- **media** - Binary asset registry (active)
- **media_processing_queue** - Image processing queue (active)

---

## ⚙️ Agent Configuration Files

Site-specific agent configurations live in the content submodule under `content/config/`:

### Configuration Types

| File | Purpose | Used By |
|------|---------|---------|
| `agent-schemas.json` | Block type documentation for LLMs | All agents |
| `writer-prompt.json` | Editorial voice override | WriterAgent |
| `collection-research.json` | Research workflow configuration | CollectionResearchWorkflow |
| `blog-workflow.json` | Blog publishing workflow | WriterAgent, EditorAgent |
| `media-guidelines.json` | Imagery search queries and guidelines | MediaAgent |
| `villages/*.json` | Village-specific localized content | All agents |

### Writer Prompt Override Example
```json
{
  "website_prompt_template": {
    "name": "Cinque Terre Writer Prompt",
    "capability": "write_draft",
    "template_additions": "## Editorial Voice\nYou are writing as Giulia Rossi...",
    "variables_override": {
      "brand_name": "Cinque Terre Dispatch",
      "editor_name": "Giulia Rossi",
      "editorial_tone": "warm, knowledgeable, personal"
    },
    "examples_override": [
      {
        "type": "editorial-hero",
        "example": { "title": "...", "subtitle": "...", "badge": "Local Secrets" }
      }
    ]
  }
}
```

### Collection Research Config Example
```json
{
  "collections": {
    "restaurants": {
      "research_prompt": "Find authentic local restaurants in {village}...",
      "search_queries": ["best restaurants {village} Cinque Terre", "local trattoria {village}"],
      "extraction_hints": ["rating", "price_range", "cuisine_type", "local_favorite"],
      "max_results": 10
    }
  },
  "research_schedule": {
    "restaurants": "quarterly",
    "hikes": "weekly",
    "events": "daily"
  }
}
```

### Village JSON Config Example
```json
{
  "slug": "riomaggiore",
  "seo": {
    "title": { "en": "Riomaggiore | Cinque Terre Dispatch", "de": "...", "fr": "...", "it": "..." },
    "description": { "en": "Discover Riomaggiore, the easternmost village...", ... }
  },
  "hero": {
    "image": "https://images.unsplash.com/...",
    "title": { "en": "Riomaggiore", ... },
    "subtitle": { "en": "The easternmost jewel of Cinque Terre...", ... }
  },
  "intro": {
    "essentials": {
      "today": { "weather": "23°C, sunny", "seaTemp": "21°C", "sunset": "20:47" },
      "character": { "origins": "Born in 8th Century", "rating": "4.6/5" }
    }
  }
}
```

---

## 🎨 Site Builder (Astro)

### 46 Block Types (with Zod Validation)

Block types are defined in `packages/shared/src/content/blocks.ts`. Marketing,
E-commerce and Application-UI block schemas were pruned per audit item 8 (no
renderer existed and the cinque-terre theme did not use them); restore from
git history if a future theme needs them.

| Category | Count | Examples |
|----------|-------|----------|
| **Core** | 12 | paragraph, heading, hero, image, gallery, quote, list, faq, callout, embed, collection-embed, map |
| **Section (theme-adjacent)** | 8 | hero-section, feature-section, stats-section, cta-section, faq-section, content-section, newsletter, section-header |
| **Cinque Terre Theme** | 12 | village-selector, places-to-stay, eat-drink, featured-carousel, highlights, audio-guides, practical-advice, etc. |
| **Editorial** | 5 | editorial-hero, editorial-intro, editorial-interlude, editor-note, closing-note |
| **Template** | 9 | itinerary-hero, itinerary-days, team-grid, airports-overview, weather-live, weather-journal, blog-article, collection-with-interludes, blog-index |

A coverage test at `packages/site-builder/test/block-coverage.test.ts` asserts
every block type has a matching `case` in
`packages/site-builder/src/themes/cinque-terre/src/ContentRenderer.astro` and
vice versa. Run with `tsx packages/site-builder/test/block-coverage.test.ts`.

### Theme Architecture
```
packages/site-builder/src/themes/
└── cinque-terre/              # Reference implementation
    ├── src/
    │   ├── components/        # 35+ Astro components
    │   │   ├── blocks/        # Block renderers
    │   │   ├── ui/            # shadcn/ui components
    │   │   └── ...            # Navigation, Footer, etc.
    │   ├── config/            # Theme configuration
    │   │   ├── navigation.config.ts  # Coastal Spine navigation
    │   │   └── village-content.config.ts  # Loads from JSON
    │   ├── pages/             # Dynamic routes
    │   │   └── [lang]/        # Multi-language routing
    │   │       └── [village]/ # Village-scoped pages
    │   ├── layouts/           # Layout templates
    │   └── ContentRenderer.astro  # Block rendering engine
    └── astro.config.mjs       # Astro configuration
```

### Generator
```
packages/site-builder/src/generator/
├── build.ts    # Astro build execution
├── deploy.ts   # Deployment to platforms
└── index.ts
```

---

## 🖥️ Admin Dashboard

### Key Features
- **Sitemap Graph** - Visual sitemap with drag-drop
- **Editorial Kanban** - Task management with columns
- **Gantt View** - Timeline visualization
- **Blueprint Editor** - Page template designer
- **Page Editor** - Visual page content editing with SlugPicker for collections
- **Site Editor** - Site-wide configuration with LocalizedStringEditor
- **Collections Browser** - Browse and manage collection items
- **GitHub Integration** - Repo connection, sync panel
- **Analytics Overlays** - SEO metrics, suggestions
- **User Management** - GitHub OAuth, team switching

### Component Structure
```
apps/admin/src/components/
├── sitemap/
│   ├── PageNode.tsx           # Graph nodes
│   ├── ClusterNode.tsx        # Node clusters
│   ├── SitemapControls.tsx    # Toolbar
│   ├── GitHubSyncPanel.tsx    # Sync status
│   ├── AnalyticsOverlay.tsx   # Metrics
│   └── SuggestionsOverlay.tsx # AI suggestions
├── page-editor/
│   ├── PageEditor.tsx         # Main page editor
│   ├── SectionPropertiesPanel.tsx # Section editing
│   └── SlugPicker.tsx         # Collection item picker with search/reorder
├── site-editor/
│   ├── SiteEditor.tsx         # Site configuration editor
│   ├── ContextPanel.tsx       # Context-aware settings
│   ├── LocalizedStringEditor.tsx # Multi-language string editor
│   └── nodes/PageNode.tsx     # Page tree nodes
├── collections/
│   ├── CollectionBrowser.tsx  # Main collection browser
│   ├── CollectionTypeList.tsx # Collection type navigation
│   ├── CollectionItemsGrid.tsx # Grid display of items
│   ├── CollectionItemCard.tsx # Item card component
│   └── CollectionItemDetail.tsx # Item detail view
├── editorial/
│   ├── KanbanBoard.tsx        # Main kanban
│   ├── KanbanView.tsx         # View wrapper
│   ├── TaskCard.tsx           # Task cards
│   ├── TaskFormModal.tsx      # Create/edit
│   ├── GanttView.tsx          # Timeline
│   └── GraphView.tsx          # Dependency graph
├── blueprints/
│   ├── BlueprintEditor.tsx    # Template editor
│   ├── BlueprintCanvas.tsx    # Visual canvas
│   └── ComponentLibrary.tsx   # Block palette
├── ui/                        # shadcn/ui components
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   ├── kanban.tsx
│   ├── gantt.tsx
│   └── ... (20+ components)
├── GitHubConnector.tsx        # OAuth flow
├── DeploymentPanel.tsx        # GitHub Pages deploy
├── AppSidebar.tsx             # Navigation
├── AppLayout.tsx              # Main layout
└── UserNav.tsx                # User menu
```

---

## ⚠️ Critical Rules (Never Break These)

1. **Never skip workflows** — All content must go through the full BPMN process
2. **Never bypass state machines** — All transitions go through `executeTransition()`, which writes the audit row, the entity update, and the outbox event in one transaction
3. **Never let agents act outside their role** — Enforce RBAC strictly
4. **All content I/O goes through `RepoClient`** — agents never touch Octokit directly. Import via `@swarm-press/github-integration`'s `getRepoClient(websiteId)`.
5. **Content lives in the site repo, never in Postgres** — page bodies and collection items belong in `content/pages/` and `content/collections/` of the site's GitHub repo. The Postgres columns `content_items.body` and `collection_items.data` are DEPRECATED.
6. **Build and deploy are owned by each site's own GitHub Actions workflow** — the platform never runs Astro locally and never pushes to gh-pages. Merging the editorial PR is what triggers deployment.
7. **Always emit state-change events via the outbox** — direct `eventBus.publish()` from inside a state-changing transaction is forbidden; insert into `event_outbox` in the same tx and let `OutboxWorker` deliver. Build/deploy events are NOT outbox-driven; they are observed via the GitHub `deployment_status` webhook.
8. **Always use QuestionTickets for escalation** — No informal CEO pings
9. **Agents are stateless** — No instance fields for conversation/cache; `AgentFactory` always returns fresh instances
10. **Temporal workflow code must be deterministic** — No `Date.now()`, `Math.random()`, `crypto.randomUUID()`, or `fetch()` inside `packages/workflows/src/workflows/**`. Use the determinism activities. ESLint enforces this.
11. **Temporal calls agents synchronously** — Not event-driven
12. **Content is JSON blocks** — Not plain Markdown, not MDX. Renderers do not parse markdown at render time.
13. **LocalizedString must always include `en`** — Read via `getLocalizedValue(value, locale)`, never `value[locale] || value.en`
14. **Schema appends go after the AUDIT TRAILER marker** — In their own `BEGIN/COMMIT` block, so parallel worktrees can merge cleanly
15. **Spec is the source of truth** — Implementation follows spec
16. **CEO has final authority** — No agent can override CEO decisions

---

## 🧪 Development Workflow

### Local Setup

```bash
# 1. Clone repo
git clone <repo-url>
cd swarm-press

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with API keys

# 4. Start infrastructure
docker compose up -d  # PostgreSQL, NATS, Temporal

# 5. Bootstrap
tsx scripts/bootstrap.ts

# 6. Run development servers
pnpm dev  # Starts all services
```

### Key Commands

```bash
# Build all packages
pnpm build

# Run API server
pnpm --filter @swarm-press/backend dev

# Run Temporal worker
pnpm --filter @swarm-press/workflows dev

# Run admin dashboard
pnpm --filter @swarm-press/admin dev

# Run tests
tsx scripts/test-e2e.ts

# Reset database
tsx scripts/clear.ts
tsx scripts/seed.ts
```

### Accessing Services

| Service | URL |
|---------|-----|
| **API Server** | http://localhost:3000 |
| **Admin Dashboard** | http://localhost:4321 |
| **Temporal UI** | http://localhost:8233 |
| **NATS Monitoring** | http://localhost:8222 |

---

## 📚 Key References

### Documentation
| Resource | Location |
|----------|----------|
| **Documentation Index** | `docs/index.md` |
| **Architecture Overview** | `docs/architecture/overview.md` |
| **API Reference** | `docs/reference/api.md` |
| **Quickstart Guide** | `docs/getting-started/quickstart.md` |
| **Deployment Guide** | `docs/guides/deployment.md` |
| **Vocs Doc Site** | `apps/docs/` (run with `pnpm docs:dev`) |

### Specifications (Authoritative)
| Resource | Location |
|----------|----------|
| **Full Specification** | `specs/specs.md` |
| **GitHub Integration Design** | `specs/idea.md` |
| **Sitemap Spec** | `specs/sitemap-component.md` |
| **Editorial Planning Spec** | `specs/agentic_editorial_planning_spec.md` |
| **Collections Spec** | `specs/collections_binaries.md` |

### Source Code
| Resource | Location |
|----------|----------|
| **Database Schema** | `packages/backend/src/db/migrations/000_schema.sql` |
| **Agent Definitions** | `packages/agents/src/` |
| **Temporal Workflows** | `packages/workflows/src/workflows/` |
| **API Routers** | `packages/backend/src/api/routers/` |
| **Block Components** | `packages/site-builder/src/components/blocks/` |
| **Collection Schemas** | `packages/shared/src/content/collections/` |

---

## 🚀 Implementation Status

### Core Platform (Complete)
- [x] Monorepo setup (Turborepo + pnpm)
- [x] Database schema with all core entities
- [x] 11 autonomous agents (Writer, Editor, QA, Media, MediaSelector, Linker, PageOrchestrator, PagePolish, Audit, Engineering, CEOAssistant)
- [x] 11 Temporal workflows (content, editorial, publishing, batch, scheduling, QA, etc.)
- [x] State machine engine with audit log
- [x] NATS event bus with CloudEvents
- [x] tRPC API with 27 routers
- [x] GitHub integration (PRs, Issues, webhooks, sync, OAuth)
- [x] Admin dashboard (sitemap, kanban, blueprints, collections, scheduling)
- [x] Prompt management system (3-level hierarchy)
- [x] 50+ operational scripts (indexed in `scripts/README.md`; shared env helpers in `scripts/utils/env.ts`)
- [x] Documentation site (Vocs)
- [x] Transactional outbox for at-least-once CloudEvent delivery (`event_outbox` + `OutboxWorker`)
- [x] Optimistic concurrency on state transitions (`StateTransitionConflict`)
- [x] Block-coverage test (`packages/site-builder/test/block-coverage.test.ts`)
- [x] ESLint determinism rule for Temporal workflow code

**Agent System:**
- [x] WriterAgent with language guidelines and personas
- [x] EditorAgent with editorial config loader
- [x] QAAgent for quality assurance
- [x] MediaAgent and MediaSelectorAgent for media
- [x] LinkerAgent for internal linking
- [x] PageOrchestratorAgent for page coordination
- [x] PagePolishAgent for coherence
- [x] AuditAgent for content auditing
- [x] EngineeringAgent — DEPRECATED build/deploy tools (`build_site`, `deploy_site`, `publish_website`, `validate_content`, `build_from_github`); active tools are GitHub sync helpers and batch processing
- [x] CEOAssistantAgent for escalations
- [x] Agent adapters (REST, GraphQL, MCP, JavaScript sandbox)
- [x] **RepoClient**: per-website GitHub abstraction
      (`packages/github-integration/src/repo-client.ts`) — single content
      I/O path; agents never touch Octokit directly

**Workflow System:**
- [x] Content Production workflow
- [x] Editorial Review workflow
- [x] Publishing workflow — repo-canonical: merges editorial PR, then
      waits for `deployment_status` webhook. No longer triggers local
      Astro builds.
- [x] Batch Processing workflow
- [x] Page Content Generation workflow
- [x] Collection Research workflow
- [x] QA Gate workflow
- [x] Scheduled Content workflow
- [x] Scheduled Maintenance workflow
- [x] Content Integrity workflow
- [x] Website Generation workflow

**Build & Deploy (DEPRECATED platform paths — owned by site repo Actions):**
- [~] `EngineeringAgent.{build_site, deploy_site, publish_website, validate_content, build_from_github}` — handlers retained, NOT registered as Claude tools
- [~] `packages/site-builder/src/generator/build.ts` — local Astro build, deprecated; do not add new callers
- [~] `packages/site-builder/src/generator/deploy.ts` — Octokit gh-pages push, deprecated; do not add new callers
- [~] `github.deployToPages` tRPC mutation — deprecated; logs warning, retained for backward compat
- [~] Local Astro build on Temporal worker — replaced by GitHub Actions in each site repo

**Webhook surface (WS4):**
- [x] `pull_request.opened` handler — upserts `pr_content_mappings`
- [x] `push` to main handler — emits `content.pushed` CloudEvent into outbox
- [x] `deployment_status` handler — records deploy completion in `state_audit_log` and on the `websites` row
- [x] `pr_content_mappings` table — PR ↔ content_item mapping for editor approval flow

**Autonomous Scheduling:**
- [x] Temporal Schedules integration
- [x] 4 schedule types (content, media, links, stale)
- [x] Schedule management API
- [x] Execution history tracking
- [x] Calendar view in admin
- [x] Manual trigger capability

**Batch Processing:**
- [x] Batch job management
- [x] Progress tracking
- [x] Error handling per item
- [x] Resumable jobs

**Collections System:**
- [x] 8+ collection types (restaurants, accommodations, hikes, etc.)
- [x] Collection research workflow
- [x] Version history
- [x] Collections browser UI
- [x] SlugPicker for embedding

**Cinque Terre Theme:**
- [x] 46 block types with Zod validation (down from 67 after audit item 8)
- [x] 39 Astro components
- [x] Multi-language support (EN/DE/FR/IT)
- [x] Village JSON configuration
- [x] Content submodule architecture
- [x] Weather integration

**Admin Dashboard:**
- [x] Collections browser
- [x] Page editor with SlugPicker
- [x] Site editor with LocalizedStringEditor
- [x] Schedule management panel
- [x] Schedule calendar
- [x] Execution history

**Services:**
- [x] Image generation service
- [x] Stock photo service
- [x] Weather API service
- [x] WKI (Website Knowledge Index) builder
- [x] Batch processing service
- [x] Storage service (S3/R2)

### Post-MVP Roadmap
- [ ] Multi-tenancy
- [ ] Distribution agent (social media, newsletters)
- [ ] Advanced analytics dashboard
- [ ] Visual workflow editor
- [ ] CEO oversight dashboard
- [ ] Advanced observability (Prometheus, tracing)

---

## 🤝 Contributing

When working on swarm.press:

1. **Read the spec first** — `specs/specs.md` is authoritative
2. **Update the schema** — `000_schema.sql` is the source of truth
3. **Write tests** — Unit tests for agents, integration tests for workflows
4. **Emit events** — Every state change should publish a CloudEvent
5. **Document decisions** — Update this file when making architectural changes
6. **Follow patterns** — Look at existing code for examples

---

**Last Updated:** 2026-05-11
**Implementation Status:** Production Ready with Autonomous Scheduling

---

**Remember:** swarm.press is not just AI content generation. It's a fully structured, autonomous publishing organization with real workflows, real governance, and real accountability. Build it accordingly.
