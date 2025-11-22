# swarm.press — Claude Development Guide

> **Last Updated:** 2025-11-22
> **Status:** MVP Implementation Phase
> **Spec Version:** 1.0

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

### 2. **Agents Are Employees**
Each agent has:
- A role (Writer, Editor, SEO Specialist, etc.)
- Capabilities (what it can do)
- Constraints (what it cannot do)
- Escalation rules (when to ask for help)
- Tools (functions it can call)

### 3. **Workflows Are BPMN 2.0**
All processes are explicit, auditable, and executable:
- Content Production: idea → draft → review → publish
- Editorial Review: submit → approve/reject → revise loop
- Publishing: build → validate → deploy

### 4. **No Silent Magic**
Every action produces:
- A Task
- An Event (CloudEvents)
- A State Transition
- A Review or QuestionTicket

### 5. **CEO Has Final Authority**
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
| **Content Storage** | PostgreSQL + S3/MinIO | Metadata in DB, media in object storage |
| **Website Generator** | Astro | Static/hybrid sites, component-based |
| **Monorepo** | Turborepo or Nx | Shared types, schemas, unified builds |
| **CEO Dashboard** | Astro or Next.js | Web UI for human oversight |

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

**Why synchronous?**
- Deterministic workflow execution
- Built-in retries and error handling
- Easy debugging and replay

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

## 📂 Monorepo Structure

```
swarm-press/
├── packages/
│   ├── backend/          # API, PostgreSQL models, business logic
│   ├── workflows/        # Temporal workflows + activities
│   ├── agents/           # Claude Agent SDK implementations
│   ├── shared/           # JSON schemas, types, state machines
│   ├── site-builder/     # Astro website generation
│   ├── event-bus/        # NATS/CloudEvents integration
│   └── cli/              # Operator CLI (swarmpress commands)
├── apps/
│   └── dashboard/        # CEO web UI
├── scripts/
│   └── bootstrap/        # Initial setup scripts
├── domain/
│   ├── schemas/          # JSON Schema files (to be created)
│   └── workflows/bpmn/   # BPMN 2.0 files (to be created)
├── docs/
│   └── specs/
│       └── specs.md      # Full specification (2,300+ lines)
├── CLAUDE.md             # This file
└── README.md             # User-facing documentation
```

---

## 🗂️ Domain Model (Core Entities)

All entities defined in `specs/specs.md` Part 3.

### Primary Entities

| Entity | Purpose | Key Fields |
|--------|---------|------------|
| **Company** | Top-level organization | id, name, description |
| **Department** | Organizational unit | id, company_id, name |
| **Role** | Function within department | id, department_id, name |
| **Agent** | Virtual employee | id, role_id, name, persona, capabilities[] |
| **Website** | Publication surface | id, domain, title |
| **WebPage** | Route/page within site | id, website_id, slug, template |
| **ContentItem** | Atomic content unit | id, type, body (JSON blocks), status, author_agent_id |
| **Task** | Assigned work | id, type, status, agent_id, content_id |
| **Review** | Editorial decision | id, content_id, reviewer_agent_id, result, comments |
| **QuestionTicket** | Escalation to CEO/Editor | id, created_by_agent_id, target, subject, body, status |

### ContentItem Lifecycle

```
idea → planned → brief_created → draft → in_editorial_review
  → needs_changes (loops back to draft)
  → approved → scheduled → published → archived
```

---

## 🤖 Agent Specifications

### Core Agents (MVP)

| Agent | Department | Capabilities |
|-------|-----------|--------------|
| **WriterAgent** | Writers Room | research_topic, write_draft, revise_draft, submit_for_review |
| **EditorAgent** | Editorial | review_content, request_changes, approve_content, reject_content, escalate_to_ceo |
| **EngineeringAgent** | Engineering | prepare_build, validate_assets, publish_site |
| **CEOAssistantAgent** | Governance | summarize_tickets, organize_escalations, notify_ceo |

### Agent Tool Pattern

```typescript
// packages/agents/src/agents/writer-agent.ts
export const writerAgent = {
  name: 'WriterAgent',
  role: 'writer',
  persona: 'Creative, articulate, research-driven',

  tools: {
    async write_draft(brief: Brief): Promise<ContentItem> {
      // 1. Call Claude to generate draft
      const draftText = await callClaude({
        system: "You are a professional writer...",
        prompt: `Write an article based on: ${brief.description}`
      })

      // 2. Structure as JSON blocks
      const body = parseIntoBlocks(draftText)

      // 3. Save to database
      const content = await db.contentItems.create({
        type: 'article',
        body,
        status: 'draft',
        author_agent_id: 'writer-01'
      })

      // 4. Emit event
      await eventBus.publish('content.created', { id: content.id })

      return content
    },

    async submit_for_review(contentId: string) {
      await stateMachine.transition(contentId, 'draft', 'in_editorial_review')
      await eventBus.publish('content.submittedForReview', { id: contentId })
    }
  }
}
```

---

## 🔄 Workflows (BPMN 2.0)

### Content Production Workflow

```
1. Chief Editor creates brief
2. WriterAgent drafts content
3. WriterAgent submits for review
4. EditorAgent reviews
   - needs_changes → back to step 2
   - rejected → END
   - approved → continue
5. SEO optimization (stubbed in MVP)
6. Media assets (stubbed in MVP)
7. EngineeringAgent prepares build
8. (Optional) CEO approves if high-risk
9. EngineeringAgent publishes
10. CloudEvent: content.published
```

**Temporal Implementation:**
```typescript
// packages/workflows/src/content-production.ts
export async function contentProductionWorkflow(briefId: string) {
  const brief = await getBrief(briefId)

  // Step 1: Draft
  const draft = await callAgent('WriterAgent', 'write_draft', brief)

  // Step 2: Review
  const review = await callAgent('EditorAgent', 'review_content', draft)

  // Step 3: Handle review result
  if (review.result === 'needs_changes') {
    await callAgent('WriterAgent', 'revise_draft', {
      contentId: draft.id,
      feedback: review.comments
    })
    // Temporal will retry this workflow
    return await contentProductionWorkflow(briefId)
  }

  if (review.result === 'rejected') {
    return { status: 'rejected' }
  }

  // Step 4: Publish
  await callAgent('EngineeringAgent', 'publish_site', { contentId: draft.id })

  return { status: 'published', contentId: draft.id }
}
```

---

## 📡 Events (CloudEvents)

### Event Categories

| Category | Events |
|----------|--------|
| **Content** | content.created, content.submittedForReview, content.approved, content.published |
| **Review** | review.completed, review.needsChanges |
| **Tasks** | task.created, task.completed |
| **Tickets** | ticket.created, ticket.answered, ticket.closed |
| **Publishing** | deploy.started, deploy.success, deploy.failed |

### Event Structure

```json
{
  "specversion": "1.0",
  "type": "swarmpress.content.submittedForReview",
  "source": "/agents/writer/writer-01",
  "subject": "content/abc123",
  "id": "evt-001",
  "time": "2025-11-22T12:00:00Z",
  "data": {
    "content_id": "abc123",
    "submitted_by": "writer-01",
    "website_id": "site-001"
  }
}
```

### Publishing Events

```typescript
// packages/event-bus/src/publisher.ts
export async function publishEvent(event: CloudEvent) {
  await nats.publish(`swarmpress.${event.type}`, JSON.stringify(event))
}

// packages/event-bus/src/subscriber.ts
export function subscribeToEvents(handler: (event: CloudEvent) => void) {
  nats.subscribe('swarmpress.>', (msg) => {
    const event = JSON.parse(msg.data)
    handler(event)
  })
}
```

---

## 🛡️ Permissions & Governance

### RBAC Rules

| Role | Can Do | Cannot Do |
|------|--------|-----------|
| **Writer** | Create drafts, submit for review | Approve content, publish |
| **Editor** | Review, approve/reject | Publish, modify templates |
| **SEO** | Update metadata, add structured data | Rewrite content body |
| **Media** | Generate images, attach media | Modify article text |
| **Engineering** | Build, validate, publish | Approve editorial content |
| **CEO** | Override any decision, approve high-risk | N/A (ultimate authority) |

### Escalation Rules

Agents **must** create a QuestionTicket when:
- Requirements are ambiguous
- Conflicting feedback from multiple agents
- High-risk content (legal, medical, political)
- Workflow is blocked
- Technical errors prevent progress

---

## 🚀 MVP Implementation Plan

See full plan above. Key phases:

1. **Phase 0:** Monorepo + CLI setup (1-2 days)
2. **Phase 1:** Domain model + JSON schemas (2-3 days)
3. **Phase 2:** Infrastructure (PostgreSQL, NATS, Temporal) (3-4 days)
4. **Phase 3:** Agents (Writer, Editor, Engineering, CEO Assistant) (4-5 days)
5. **Phase 4:** Workflows (Content Production, Review, Publishing) (4-5 days)
6. **Phase 5:** API + Backend (3-4 days)
7. **Phase 6:** Astro Site Builder (3-4 days)
8. **Phase 7:** CEO Dashboard (3-4 days)
9. **Phase 8:** Bootstrap + Testing (2-3 days)

**Total:** ~5-7 weeks solo, ~3-4 weeks with a team

---

## 🎯 MVP Scope (What's Included)

✅ **Included in MVP:**
- Single tenant (no multi-tenancy)
- 4 core agents (Writer, Editor, Engineering, CEO Assistant)
- 3 workflows (Content Production, Editorial Review, Publishing)
- All core entities in PostgreSQL
- CloudEvents on NATS
- Astro static site generation (output to local `/dist` folder)
- CEO dashboard (QuestionTickets, approvals, activity log)
- Operator CLI (`swarmpress init`, `content:create`, etc.)
- Bootstrap script for initial setup
- Stubbed SEO and Media agents (simple placeholders)

❌ **Deferred to Post-MVP:**
- Multi-tenancy
- Real SEO optimization (keyword analysis, etc.)
- Real image generation (external API)
- Distribution agent (social media, newsletters)
- Advanced analytics
- Real deployment (S3, CDN, etc.)
- Multi-language support
- Human collaboration features

---

## 🧪 Development Workflow

### Local Setup

```bash
# 1. Clone repo
git clone <repo-url>
cd swarm-press

# 2. Install dependencies
pnpm install

# 3. Start infrastructure
docker compose up -d  # PostgreSQL, NATS, Temporal

# 4. Bootstrap initial data
pnpm cli init

# 5. Run development servers
pnpm dev  # Starts all services in parallel
```

### Testing an Agent

```bash
# Via CLI
pnpm cli agent:invoke WriterAgent write_draft '{"briefId":"123"}'

# Via API
curl -X POST http://localhost:3000/api/agents/invoke \
  -H "Content-Type: application/json" \
  -d '{"agent":"WriterAgent","tool":"write_draft","payload":{"briefId":"123"}}'
```

### Triggering a Workflow

```bash
# Via CLI
pnpm cli workflow:start content-production --briefId=123

# Via API
curl -X POST http://localhost:3000/api/workflows/start \
  -H "Content-Type: application/json" \
  -d '{"workflow":"contentProductionWorkflow","args":{"briefId":"123"}}'
```

### Viewing Events

```bash
# CLI
pnpm cli events:tail

# Dashboard
# Navigate to http://localhost:3001/activity
```

---

## 📚 Key References

| Resource | Location |
|----------|----------|
| **Full Specification** | `specs/specs.md` |
| **JSON Schemas** | `domain/schemas/` (to be created) |
| **BPMN Workflows** | `domain/workflows/bpmn/` (to be created) |
| **Agent Definitions** | `packages/agents/src/agents/` |
| **Temporal Workflows** | `packages/workflows/src/` |
| **API Endpoints** | `packages/backend/src/api/` |
| **CEO Dashboard** | `apps/dashboard/` |

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

## 🔮 Post-MVP Roadmap

After validating the core system:

1. **Multi-tenancy** — Support multiple websites/tenants
2. **Real SEO Agent** — Keyword analysis, structured data, performance tracking
3. **Real Media Agent** — Image generation via external APIs
4. **Distribution Agent** — Social media posting, newsletters
5. **Advanced Dashboard** — Analytics, performance metrics, workflow visualization
6. **Multi-language** — Translations, localization
7. **Human Collaboration** — Multiple editors, writers, reviewers
8. **Workflow Customization** — Visual workflow editor for CEO
9. **Advanced Observability** — Prometheus metrics, distributed tracing
10. **Real Deployment** — S3, CDN, CI/CD pipelines

---

## 🤝 Contributing

When working on swarm.press:

1. **Read the spec first** — `specs/specs.md` is authoritative
2. **Update schemas** — Keep JSON Schemas in sync with code
3. **Write tests** — Unit tests for agents, integration tests for workflows
4. **Emit events** — Every state change should publish a CloudEvent
5. **Document decisions** — Update this file when making architectural changes
6. **Ask questions** — Use GitHub issues or QuestionTickets pattern

---

## 📞 Support & Questions

For questions about:
- **Specification:** See `specs/specs.md`
- **Architecture:** This file (CLAUDE.md)
- **Implementation:** Check package READMEs
- **Bugs:** GitHub Issues (when available)
- **Design decisions:** Consult with project lead or CEO

---

**Last Updated:** 2025-11-22
**Spec Version:** 1.0
**Implementation Status:** Planning Complete, Ready for Phase 0

---

**Remember:** swarm.press is not just AI content generation. It's a fully structured, autonomous publishing organization with real workflows, real governance, and real accountability. Build it accordingly.
