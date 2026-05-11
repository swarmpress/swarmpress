# swarm.press — Claude Development Guide

> **Last Updated:** 2026-05-11
> **Status:** Production Ready with Autonomous Scheduling
> **Spec Version:** 1.1
> **Schema Version:** 1.2.0 (46 block types, 11 agents, 11 workflows)

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
- The schema implements all specifications from `specs/` directory

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
}

// ✅ GOOD: All state in PostgreSQL
class WriterAgent {
  async writeDraft(brief: Brief) {
    const draft = await callClaude(...)
    await db.contentItems.insert(draft) // State goes to DB
    await eventBus.publish('content.created', { id: draft.id })
    return draft
  }
}
```

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

// Update DB + emit event
await db.contentItems.updateStatus('123', 'in_editorial_review')
await eventBus.publish('content.submittedForReview', { id: '123' })
```

---

## 📦 Content Architecture Pattern

swarm.press separates **operational metadata** from **content**:

### Storage Separation
| Type | Location | Purpose |
|------|----------|---------|
| **Metadata** | PostgreSQL | Agents, workflows, state, tasks, reviews |
| **Content** | Git Submodule (JSON) | Pages, collections, configurations |
| **Media** | S3/Cloudflare R2 | Images, videos, binary assets |

### Why Separate?
- **Version Control**: Content changes tracked in Git with full history
- **Agent Collaboration**: Agents write JSON, humans review PRs
- **Theme Decoupling**: Same content, different presentations
- **Multi-language**: Localized content in structured JSON format

### Content Repository Structure
```
{site}.travel/content/
├── config/                      # Agent configuration files
│   ├── agent-schemas.json       # Block type documentation for agents
│   ├── writer-prompt.json       # WriterAgent editorial voice override
│   ├── collection-research.json # Research workflow configuration
│   ├── blog-workflow.json       # Blog publishing workflow
│   ├── media-guidelines.json    # MediaAgent imagery guidelines
│   └── villages/                # Village-specific JSON configs
│       └── {village}.json       # Per-village localized content
├── pages/                       # Page content (JSON blocks)
│   ├── index.json               # Homepage
│   ├── {village}.json           # Village overviews
│   └── {village}/               # Village-specific sections
└── collections/                 # Collection data
    ├── restaurants/             # Per-village restaurants
    ├── accommodations/          # Per-village hotels
    └── hikes/                   # Hiking trails
```

### Agent Workflow with Content
```
┌─────────────────────────────────────────────────────────────┐
│  AGENT WORKFLOW                                             │
├─────────────────────────────────────────────────────────────┤
│  1. WriterAgent receives task from Temporal workflow        │
│  2. Agent generates JSON blocks using block schemas         │
│  3. JSON committed to content submodule                     │
│  4. Pull Request created for human review                   │
│  5. EditorAgent or human reviews and approves               │
│  6. PR merged → triggers build → site deployed              │
└─────────────────────────────────────────────────────────────┘
```

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
// All user-facing content uses this pattern
type LocalizedString = {
  en: string  // English (required)
  de?: string // German
  fr?: string // French
  it?: string // Italian
}

// Example usage in village JSON
{
  "title": {
    "en": "Riomaggiore",
    "de": "Riomaggiore",
    "fr": "Riomaggiore",
    "it": "Riomaggiore"
  },
  "subtitle": {
    "en": "The easternmost jewel of Cinque Terre...",
    "de": "Das östlichste Juwel der Cinque Terre...",
    "fr": "Le joyau le plus oriental des Cinque Terre...",
    "it": "Il gioiello più orientale delle Cinque Terre..."
  }
}
```

### Theme Features
- **Coastal Spine Navigation**: Village-centric geographic navigation
- **5 Villages**: Riomaggiore, Manarola, Corniglia, Vernazza, Monterosso
- **35+ Astro Components**: Editorial blocks, village content, collections
- **Dynamic Village Config**: JSON-based village data (weather, character, essentials)

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
- **pages** - Sitemap structure with agentic features
  - SEO profiles, internal links, suggestions, tasks (all JSONB)
  - Hierarchical structure (parent_id)
- **content_blueprints** - Page templates
- **content_items** - Actual content with JSON body

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
| **EngineeringAgent** | Engineering | prepare_build, validate_assets, publish_site |
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

### Database Tables (from spec, to be added)
- **website_collections** - Per-website collection config
- **collection_items** - Actual collection records
- **collection_item_versions** - Version history
- **media** - Binary asset registry
- **media_processing_queue** - Image processing queue

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
2. **Never bypass state machines** — All transitions must be validated
3. **Never let agents act outside their role** — Enforce RBAC strictly
4. **Always emit events** — Every significant action produces a CloudEvent
5. **Always use QuestionTickets for escalation** — No informal CEO pings
6. **Agents are stateless** — All state goes to PostgreSQL
7. **Temporal calls agents synchronously** — Not event-driven
8. **Content is JSON blocks** — Not plain Markdown, not MDX
9. **Spec is the source of truth** — Implementation follows spec
10. **CEO has final authority** — No agent can override CEO decisions

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
- [x] 50+ operational scripts
- [x] Documentation site (Vocs)

**Agent System:**
- [x] WriterAgent with language guidelines and personas
- [x] EditorAgent with editorial config loader
- [x] QAAgent for quality assurance
- [x] MediaAgent and MediaSelectorAgent for media
- [x] LinkerAgent for internal linking
- [x] PageOrchestratorAgent for page coordination
- [x] PagePolishAgent for coherence
- [x] AuditAgent for content auditing
- [x] EngineeringAgent for builds
- [x] CEOAssistantAgent for escalations
- [x] Agent adapters (REST, GraphQL, MCP, JavaScript sandbox)

**Workflow System:**
- [x] Content Production workflow
- [x] Editorial Review workflow
- [x] Publishing workflow
- [x] Batch Processing workflow
- [x] Page Content Generation workflow
- [x] Collection Research workflow
- [x] QA Gate workflow
- [x] Scheduled Content workflow
- [x] Scheduled Maintenance workflow
- [x] Content Integrity workflow
- [x] Website Generation workflow

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
