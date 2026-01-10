# swarm.press

**A Fully Autonomous Virtual Publishing House**

swarm.press is a production-ready publishing platform operated entirely by intelligent Claude agents. The system handles content creation, editorial review, site generation, and deployment with human oversight through GitHub collaboration.

## Key Features

- **4 Autonomous Agents**: Writer, Editor, Engineering, and CEO Assistant using Claude Agent SDK
- **Durable Workflows**: Temporal.io orchestration for fault-tolerant execution
- **GitHub Collaboration**: All content review happens through Pull Requests
- **Event-Driven**: NATS JetStream with CloudEvents v1.0
- **Type-Safe API**: tRPC endpoints with full type safety
- **Static Site Generation**: Astro with 60+ JSON block types (Zod validated)
- **State Machine Validation**: All entity transitions validated and audited
- **Real-Time Updates**: Server-Sent Events for live monitoring
- **Content Submodule Architecture**: Metadata in DB, content in Git-versioned JSON
- **Multi-Language Support**: LocalizedString pattern for EN/DE/FR/IT
- **Reference Implementation**: Cinque Terre travel site with 35+ themed components
- **Admin Dashboard**: Collections browser, page editor, site editor with i18n support

## Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Agents** | Claude Agent SDK | Autonomous task execution |
| **Orchestration** | Temporal.io | Workflow management |
| **Events** | NATS + CloudEvents | Event-driven communication |
| **Database** | PostgreSQL | Operational state storage |
| **API** | Express + tRPC | Type-safe endpoints |
| **Site Builder** | Astro | Static site generation |
| **Collaboration** | GitHub | Content review & governance |
| **Monorepo** | Turborepo + pnpm | Build system |

### Package Structure

```
swarmpress/
├── packages/
│   ├── backend/              # API server, repositories, state machine
│   ├── workflows/            # Temporal workflows and activities
│   ├── agents/               # Claude agents (4 agents)
│   ├── shared/               # Types, 60+ block Zod schemas, utilities
│   ├── site-builder/         # Astro site generator
│   │   └── src/themes/       # Site-specific themes
│   │       └── cinque-terre/ # Reference implementation (35+ components)
│   ├── event-bus/            # NATS event publishing
│   ├── github-integration/   # GitHub collaboration layer
│   └── cli/                  # Operator CLI (future)
├── cinqueterre.travel/       # Content submodule (Git)
│   └── content/
│       ├── config/           # Agent configuration files
│       │   ├── agent-schemas.json    # Block documentation for agents
│       │   ├── writer-prompt.json    # Editorial voice override
│       │   ├── collection-research.json # Research workflow config
│       │   └── villages/     # Village-specific JSON configs
│       ├── pages/            # Page content (JSON blocks)
│       └── collections/      # Collection data (restaurants, hikes, etc.)
├── scripts/
│   ├── bootstrap.ts          # System initialization
│   ├── seed.ts               # Sample data
│   ├── clear.ts              # Reset database
│   └── test-e2e.ts           # End-to-end tests
├── domain/
│   ├── schemas/              # JSON Schema files
│   └── workflows/bpmn/       # BPMN workflow diagrams
├── specs/
│   ├── specs.md              # Full specification
│   └── idea.md               # GitHub integration design
├── docker-compose.yml        # PostgreSQL, NATS, Temporal
└── turbo.json                # Monorepo build config
```

### Content Architecture

swarm.press separates **operational metadata** from **content**:

| Storage | Purpose | Examples |
|---------|---------|----------|
| **PostgreSQL** | Metadata, workflows, state | Agents, tasks, reviews, audit log |
| **Git Submodule** | Content (JSON) | Pages, collections, agent configs |
| **S3/R2** | Media | Images, videos, binaries |

This enables Git-based version control, PR-based review, and theme decoupling.

## Quick Start

### Prerequisites

- **Node.js** 18+
- **pnpm** 8+
- **Docker** & Docker Compose
- **Anthropic API Key** ([Get one here](https://console.anthropic.com))
- **GitHub Token** (for collaboration features)

### Installation

```bash
# 1. Clone repository
git clone <your-repo>
cd swarmpress

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys and configuration

# 4. Bootstrap the system
tsx scripts/bootstrap.ts
```

The bootstrap script will:
- Validate your environment
- Start Docker services (PostgreSQL, NATS, Temporal)
- Run database migrations
- Seed sample data (1 website, 4 agents, sample content)
- Initialize GitHub integration

### Running the System

```bash
# Terminal 1: API Server
pnpm --filter @swarm-press/backend dev

# Terminal 2: Temporal Worker
pnpm --filter @swarm-press/workflows dev

# Terminal 3: Monitor events (optional)
curl -N http://localhost:3000/api/events/stream
```

**API Available at**: `http://localhost:3000`

### Verify Setup

```bash
# Check health
curl http://localhost:3000/health

# List content
curl -H "Authorization: Bearer system" \
  http://localhost:3000/api/trpc/content.list

# Check Docker services
docker-compose ps

# Access Temporal UI
open http://localhost:8233
```

## Content Workflow

The complete content lifecycle from creation to publishing:

```
1. CEO creates brief → ContentItem (brief_created)
2. WriterAgent writes draft → (draft)
3. EditorAgent reviews quality → (in_editorial_review)
   - If high-risk: Creates GitHub PR for CEO approval
   - CEO reviews and approves via GitHub PR review
4. EditorAgent approves → (approved)
5. SEOAgent optimizes metadata → (scheduled)
6. EngineeringAgent validates → (building)
7. EngineeringAgent builds & publishes → (published)
```

All state transitions are:
- Validated by the state machine engine
- Recorded in audit log (`state_audit_log` table)
- Published as CloudEvents to NATS
- Synchronized to GitHub (for review states)

## GitHub Collaboration

### Why GitHub?

Instead of building a custom dashboard, swarm.press uses GitHub as the collaboration surface:
- **Zero custom UI development** - Use GitHub's polished interface
- **Mobile access** - Via GitHub mobile app
- **Familiar workflow** - PRs and Issues developers already know
- **Complete audit trail** - All reviews, comments, approvals tracked
- **Open/transparent** - Anyone with access can see the process

### Content Review via Pull Requests

When content enters editorial review:

1. **Branch Created**: `content/{content-id}`
2. **Content Committed**: JSON file at `content/{website-id}/{slug}.json`
3. **PR Opened**: With labels `content-review`, `status:in-review`
4. **Agent Reviews**: EditorAgent adds review comments
5. **CEO Approval**: Via GitHub PR review (Approve/Request Changes)
6. **Merge on Publish**: PR merges when content is published

**Example PR**:
```
Title: 📝 The Rise of AI Agents in Modern Software
Labels: content-review, status:in-review, high-risk

## Content Summary
Brief: Exploring how AI agents are transforming software...

## Quality Score
8.5/10 (EditorAgent)

## Risk Assessment
⚠️ High-risk content - CEO approval required
Reasons: Mentions AI capabilities, makes technical claims

## Review Status
- ✅ Quality check passed
- ✅ Structure validation passed
- ⏳ Awaiting CEO approval
```

### Tasks and Questions via Issues

**Tasks** - Created as GitHub Issues:
```
Title: 🎯 Write article about AI agents
Labels: task, content-creation, assigned:WriterAgent
Status: In Progress

Description:
Create comprehensive article covering:
- What are AI agents
- Benefits and use cases
- Real-world applications
```

**Question Tickets** - CEO escalations:
```
Title: ❓ Is this content appropriate for our audience?
Labels: question, needs-ceo-response
Assigned: @ceo

Content ID: abc-123
Question from: EditorAgent

[Details of the question...]
```

### Webhook Configuration

Set up GitHub webhook to sync events back to swarm.press:

1. Go to repository Settings → Webhooks
2. Add webhook:
   - **Payload URL**: `https://your-domain.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Your `GITHUB_WEBHOOK_SECRET` from `.env`
   - **Events**: Pull requests, Pull request reviews, Issues, Issue comments
3. Save webhook

Events synced:
- **PR opened** → Triggers content review workflow
- **PR review (approved)** → Updates content state to `approved`
- **PR review (changes requested)** → Updates state to `in_revision`
- **Issue comment** → Answers question ticket
- **PR merged** → Content publishing completed

## API Documentation

### Authentication

Two authentication methods:

**1. CEO Access**:
```bash
Authorization: Bearer ceo:{email}
```

**2. System Access**:
```bash
Authorization: Bearer system
```

Configure CEO credentials in `.env`:
```bash
CEO_EMAIL=ceo@swarm.press
CEO_PASSWORD=your-secure-password
```

### tRPC Routers

The API uses tRPC for type-safe endpoints:

#### Content Router

```typescript
// List all content
content.list()

// Get by ID
content.getById({ id: 'content-id' })

// Create new content
content.create({
  websiteId: 'website-id',
  title: 'Article Title',
  brief: 'Article brief...',
  authorAgentId: 'writer-001'
})

// Transition state
content.transition({
  id: 'content-id',
  event: 'approve',
  metadata: { reviewer: 'editor-001' }
})

// Start workflow
content.startWorkflow({
  contentId: 'content-id',
  workflow: 'content-production'
})
```

#### Task Router

```typescript
// List tasks
task.list({ agentId: 'writer-001', status: 'planned' })

// Create task
task.create({
  type: 'content_creation',
  title: 'Write article',
  agentId: 'writer-001',
  contentId: 'content-id'
})

// Update status
task.updateStatus({
  id: 'task-id',
  status: 'in_progress'
})
```

#### Ticket Router

```typescript
// List tickets
ticket.list({ status: 'open' })

// Create question
ticket.create({
  question: 'Is this appropriate?',
  context: { contentId: 'content-id' },
  source: 'EditorAgent',
  target: 'CEO'
})

// Answer ticket
ticket.answer({
  id: 'ticket-id',
  answer: 'Yes, approved'
})
```

#### Website Router

```typescript
// List websites
website.list()

// Create website
website.create({
  name: 'TechBlog',
  domain: 'techblog.example.com',
  config: { theme: 'modern' }
})
```

### Event Stream (SSE)

Real-time events via Server-Sent Events:

```bash
curl -N http://localhost:3000/api/events/stream
```

Event types:
- `content.state_changed` - Content transitions
- `content.created` - New content
- `task.status_changed` - Task updates
- `task.created` - New task
- `ticket.created` - New question
- `ticket.answered` - Question answered
- `deploy.success` - Site deployed
- `deploy.failed` - Deployment failed

Example event:
```json
{
  "specversion": "1.0",
  "type": "content.state_changed",
  "source": "swarm-press/state-machine",
  "id": "event-123",
  "time": "2025-01-15T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    "contentId": "content-123",
    "from": "draft",
    "to": "in_editorial_review",
    "event": "submit_for_review",
    "actor": "WriterAgent",
    "actorId": "writer-001"
  }
}
```

## JSON Block Content Model

Content is structured as JSON blocks for LLM-friendliness and flexibility.

### 60+ Block Types

Blocks are organized into categories:

| Category | Count | Examples |
|----------|-------|----------|
| **Core** | 10 | paragraph, heading, hero, image, gallery, quote, list, faq, callout, embed |
| **Marketing** | 20 | hero-section, feature-section, pricing-section, testimonial-section, cta-section |
| **E-commerce** | 4 | product-list, product-overview, shopping-cart, promo-section |
| **Application UI** | 5 | card, data-table, form-layout, modal, alert |
| **Cinque Terre Theme** | 15 | village-selector, places-to-stay, eat-drink, featured-carousel, highlights |
| **Editorial** | 5 | editorial-hero, editorial-intro, editorial-interlude, editor-note, closing-note |
| **Template** | 9 | itinerary-hero, itinerary-days, blog-article, weather-live, collection-with-interludes |

All block types include Zod validation schemas in `packages/shared/src/content/blocks.ts`.

### Example Content

```json
{
  "id": "content-123",
  "title": "The Rise of AI Agents",
  "slug": "rise-of-ai-agents",
  "brief": "Exploring how AI agents transform software...",
  "body": [
    {
      "type": "hero",
      "title": "Welcome to the Future",
      "subtitle": "AI Agents in Modern Software",
      "backgroundImage": "https://images.unsplash.com/..."
    },
    {
      "type": "heading",
      "level": 2,
      "text": "What are AI Agents?"
    },
    {
      "type": "paragraph",
      "text": "AI agents are autonomous entities that..."
    },
    {
      "type": "image",
      "url": "https://images.unsplash.com/...",
      "alt": "AI concept",
      "caption": "The future of automation"
    },
    {
      "type": "list",
      "ordered": false,
      "items": [
        "Autonomous operation 24/7",
        "Consistent quality",
        "Scalable production"
      ]
    },
    {
      "type": "callout",
      "variant": "info",
      "title": "Did You Know?",
      "text": "AI agents can process thousands of documents..."
    }
  ],
  "status": "published",
  "metadata": {
    "tags": ["AI", "automation"],
    "reading_time": "5 min"
  }
}
```

See `packages/shared/src/content/blocks.ts` for complete schema definitions.

## State Machines

### ContentItem States

```
brief_created
    ↓
  draft
    ↓
in_editorial_review ←→ in_revision
    ↓
 approved
    ↓
 scheduled
    ↓
 building
    ↓
 published
```

**Events**: `start_draft`, `submit_for_review`, `approve`, `request_changes`, `ready_for_publish`, `start_build`, `publish`, `unpublish`

### Task States

```
planned → in_progress → completed
            ↓
         blocked
```

**Events**: `start`, `block`, `unblock`, `complete`

### QuestionTicket States

```
open → answered → resolved
```

**Events**: `answer`, `resolve`

## Agent Capabilities

### WriterAgent

**Role**: Content creation

**Capabilities**:
- Researches topics using web search
- Writes drafts from briefs
- Maintains brand voice consistency
- Delegates to SEO specialist for optimization

**Tools**:
- `research_topic` - Web search and analysis
- `write_content` - Generate content from brief
- `delegate_to_agent` - Call other agents

### EditorAgent

**Role**: Quality assurance and editorial review

**Capabilities**:
- Reviews content quality (scores 0-10)
- Detects high-risk content requiring CEO approval
- Approves or requests revisions
- Escalates to CEO via question tickets

**Tools**:
- `review_content` - Quality assessment
- `detect_risk` - Risk analysis
- `request_changes` - Send feedback to writer
- `create_ticket` - Escalate to CEO

### EngineeringAgent

**Role**: Site building and deployment

**Capabilities**:
- Validates content structure
- Builds static sites with Astro
- Deploys to platforms (Netlify, S3, local)
- Monitors build health

**Tools**:
- `validate_content` - Structure validation
- `build_site` - Astro build execution
- `deploy_site` - Deployment to platforms
- `check_deployment` - Health checks

### CEOAssistantAgent

**Role**: Executive support and organization

**Capabilities**:
- Organizes and summarizes tickets
- Prioritizes tasks across agents
- Prepares briefings for CEO
- Escalates high-priority issues

**Tools**:
- `summarize_tickets` - Create summaries
- `prioritize_tasks` - Task organization
- `create_briefing` - Executive reports
- `escalate_issue` - High-priority alerts

## Development

### Project Structure

```
packages/backend/
├── src/
│   ├── api/              # Express + tRPC server
│   │   ├── trpc.ts       # tRPC setup
│   │   ├── server.ts     # Express app
│   │   ├── routers/      # API routers (4)
│   │   └── webhooks.router.ts  # GitHub webhooks
│   ├── db/
│   │   ├── connection.ts # PostgreSQL singleton
│   │   ├── repositories/ # 6 repositories
│   │   └── state-machine.ts  # State engine
│   └── event-bus/
│       └── connection.ts # NATS singleton

packages/workflows/
├── src/
│   ├── workflows/        # 3 Temporal workflows
│   ├── activities/       # Agent invocation activities
│   └── client.ts         # Temporal client

packages/agents/
├── src/
│   ├── writer.agent.ts
│   ├── editor.agent.ts
│   ├── engineering.agent.ts
│   ├── ceo-assistant.agent.ts
│   └── factory.ts        # Agent factory

packages/site-builder/
├── src/
│   ├── components/
│   │   └── blocks/       # 10 block components
│   ├── generator/        # Build and deploy
│   └── layouts/          # Astro layouts

packages/github-integration/
├── src/
│   ├── client.ts         # GitHub API wrapper
│   ├── pull-requests.ts  # PR operations
│   ├── issues.ts         # Issue operations
│   ├── webhooks.ts       # Webhook processing
│   └── sync.ts           # Bidirectional sync
```

### Running Tests

```bash
# End-to-end tests (mocked)
tsx scripts/test-e2e.ts

# Unit tests (future)
pnpm test

# Integration tests (future)
pnpm test:integration
```

### Resetting Environment

```bash
# Clear all data
tsx scripts/clear.ts

# Re-seed sample data
tsx scripts/seed.ts

# Or do both
tsx scripts/clear.ts && tsx scripts/seed.ts
```

### Building for Production

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @swarm-press/backend build
pnpm --filter @swarm-press/workflows build
```

## Deployment

See `docs/DEPLOYMENT.md` for detailed deployment guides.

### Infrastructure Requirements

- **PostgreSQL 15+**: Managed service (AWS RDS, Supabase, etc.)
- **NATS JetStream**: NATS Cloud or self-hosted cluster
- **Temporal**: Temporal Cloud or self-hosted
- **Node.js Hosting**: API server (AWS ECS, Fly.io, Railway)
- **Static Hosting**: Generated sites (Netlify, Vercel, S3 + CloudFront)

### Production Environment Variables

```bash
# Database (use SSL in production)
DATABASE_URL=postgresql://user:pass@prod-db.com:5432/swarmpress?ssl=true

# NATS (use TLS in production)
NATS_URL=nats://prod-nats.com:4222

# Temporal Cloud
TEMPORAL_URL=prod-namespace.tmprl.cloud:7233

# API
NODE_ENV=production
API_PORT=3000
API_SECRET=<strong-random-secret>
LOG_LEVEL=info

# Claude
ANTHROPIC_API_KEY=<production-key>

# GitHub App (recommended for production)
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_INSTALLATION_ID=78910
GITHUB_WEBHOOK_SECRET=<strong-random-secret>

# CORS (restrict to your domains)
CORS_ORIGIN=https://yourapp.com

# CEO
CEO_EMAIL=ceo@yourcompany.com
CEO_PASSWORD=<strong-password>
```

### Deployment Checklist

- [ ] Deploy PostgreSQL with SSL
- [ ] Deploy NATS cluster with TLS
- [ ] Set up Temporal (Cloud recommended)
- [ ] Run database migrations
- [ ] Deploy API server
- [ ] Deploy Temporal worker
- [ ] Configure GitHub webhook
- [ ] Seed initial data (website, agents)
- [ ] Set up monitoring and logging
- [ ] Configure domain and SSL certificates
- [ ] Test end-to-end workflow

## Monitoring and Observability

### CloudEvents

All significant events are published to NATS:

```bash
# Subscribe to all events
nats sub "swarmpress.>"

# Subscribe to specific event type
nats sub "swarmpress.content.>"
```

Event subjects:
- `swarmpress.content.state_changed`
- `swarmpress.content.created`
- `swarmpress.task.status_changed`
- `swarmpress.ticket.created`
- `swarmpress.deploy.success`

### Logging

Structured logging with correlation IDs (future enhancement).

### Metrics

Monitor these key metrics:
- Content items by status
- Task completion rate
- Workflow execution times
- Agent invocation success/failure
- Deployment success rate
- GitHub sync latency

## Troubleshooting

### Database Connection Failed

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check logs
docker-compose logs postgres
```

### NATS Connection Failed

```bash
# Check NATS is running
docker-compose ps nats

# Test connection
nats account info

# Check logs
docker-compose logs nats
```

### Temporal Worker Not Starting

```bash
# Check Temporal is running
docker-compose ps temporal

# Access Temporal UI
open http://localhost:8233

# Check worker logs
pnpm --filter @swarm-press/workflows dev
```

### Agent Execution Failed

```bash
# Verify API key
echo $ANTHROPIC_API_KEY

# Check quota
# Visit https://console.anthropic.com

# Review agent logs
pnpm --filter @swarm-press/agents dev
```

### GitHub Webhook Not Working

```bash
# Verify webhook URL is accessible
curl https://your-domain.com/api/webhooks/github

# Check webhook secret matches
echo $GITHUB_WEBHOOK_SECRET

# Review webhook delivery logs in GitHub
# Repository → Settings → Webhooks → Recent Deliveries
```

## Documentation

- **[Full Specification](./specs/specs.md)** - Complete system specification
- **[GitHub Integration Design](./specs/idea.md)** - Hybrid sync architecture
- **[BPMN Workflows](./domain/workflows/bpmn/)** - Visual workflow diagrams
- **[JSON Schemas](./domain/schemas/)** - Schema definitions
- **[Deployment Guide](./docs/DEPLOYMENT.md)** - Production deployment
- **[API Reference](./docs/API.md)** - Complete API documentation

## Contributing

This is a production system. For changes:

1. Create feature branch from `main`
2. Make changes with tests
3. Update documentation
4. Submit PR for review
5. Ensure CI passes
6. Get approval and merge

### Code Standards

- TypeScript strict mode
- ESLint + Prettier
- Meaningful commit messages
- Update tests with changes
- Document public APIs

## License

Private - All Rights Reserved

## Support

Questions or issues:
- Review documentation in `docs/`
- Check Temporal UI for workflow issues
- Monitor CloudEvents stream
- Review GitHub webhook delivery logs
- Check agent execution logs

---

**Built with Claude Agent SDK** | **Powered by Temporal** | **Orchestrated by NATS**
