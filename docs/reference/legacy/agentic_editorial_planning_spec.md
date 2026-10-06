# Agentic Editorial Planning System — Full Specification (Option A)

This document defines the **agentic editorial content planning system** — the second core pillar of the agentic website framework, alongside the **sitemap system**.

- **Sitemap** = structural truth (what pages & components exist, and how they relate)
- **Editorial Plan** = temporal & editorial truth (what content is created/updated when, by whom, and why)

This spec includes:

1. Vision & goals  
2. Feature description & UX (including **shadcn Data Kanban** & **shadcn Data Gantt** and **ReactFlow** graph view)  
3. Technical architecture & data model  
4. Integration with sitemap, GitHub, and agents (MCP-based)  
5. A reference `editorial-plan.schema.yaml`

---

## 1. Vision

The **agentic editorial planning system** is the **newsroom brain** of the site.

- It plans **what** to publish or update.
- It decides **when** each step happens.
- It orchestrates **which agents** do the work.
- It ensures **quality, internal linking, and non-breaking navigation**.
- It syncs to **GitHub** as the single source of truth for content, tasks, and code.

The goal is a **perpetual, autonomous editorial team** that:

- Plans content based on **events, seasons, SEO opportunities, analytics, and site strategy**.
- Coordinates multiple agents (**SEO, content, media, analytics, localization, internal-linking, etc.**).
- Uses **Kanban, Gantt, and Graph views** for both **agents** and optional **human editors**.
- Operates via **file-based configuration** (`editorial-plan.yaml`) in GitHub repositories.

---

## 2. Core Concepts

### 2.1 Editorial Plan vs Sitemap

- The **sitemap** defines:
  - Pages, page types, and routes.
  - How pages are nested and grouped.
  - Which content components live on each page.
  - Structural internal links (navigation, footers, menus).

- The **editorial plan** defines:
  - Content tasks: new articles, updates, refactors, migrations, etc.
  - Temporal planning: when each task runs (Gantt).
  - Workflow status: backlog → planned → in progress → review → publish → completed (Kanban).
  - Multi-agent responsibilities (SEO agent, media agent, etc.).
  - Internal-link actions, 404 checks, and quality checks.
  - Cross-channel distribution: social snippets, newsletters, teaser content.

**Bidirectional connection:**

- Editorial Plan → Sitemap:
  - New content tasks can spawn **new sitemap entries** (e.g., new detail pages / cluster content).
  - Tasks can **deprecate or redirect** existing pages.

- Sitemap → Editorial Plan:
  - New or changed sitemap nodes generate **follow-up content tasks** (e.g., populate required children, fill cluster gaps, ensure internal links).
  - Sitemap anomalies (orphaned pages, thin content, no internal links) become **editorial tasks**.

---

### 2.2 Agents

The system assumes a set of MCP-based virtual agents, including but not limited to:

- **Editor-in-Chief Agent**  
  Plans weekly/monthly content, resolves conflicts, prioritizes tasks.

- **SEO Agent**  
  Identifies keyword and topic opportunities, proposes new content, updates old content.

- **Content Writer Agents**  
  Generate outlines, drafts, and final content in the requested tone and language.

- **Media Agent**  
  Sources, generates, or validates visual assets (photos, illustrations, headers, teaser images).

- **Internal Linking & Integrity Agent**  
  Ensures pages link to each other correctly; detects & repairs 404s and broken references.

- **Analytics Agent**  
  Watches metrics and proposes updates, refactors, and experiments.

- **Localization Agent**  
  Schedules and coordinates translations and localized variants.

- **Distribution Agent**  
  Creates social snippets, newsletter blurbs, RSS segments, etc.

Each content task in the editorial plan is effectively a **multi-agent pipeline**.

---

## 3. UX Overview

There are three primary, synchronized views for editors and agents:

1. **Kanban View** — based on **shadcn Data Kanban**  
2. **Gantt View** — based on **shadcn Data Gantt**  
3. **Graph View** — based on **ReactFlow**

All three operate on the same editorial-plan data and can be used interchangeably based on context.

---

### 3.1 Kanban View (shadcn Data Kanban)

The **Kanban board** shows the **workflow status** of each content task.

#### 3.1.1 Columns

Default columns (configurable):

- `Backlog`  
  - Agent- or human-generated ideas.
  - SEO opportunities, seasonal suggestions, refactor proposals.

- `Planned`  
  - Approved for an upcoming sprint (e.g., next 1–4 weeks).
  - Already visible in the Gantt timeline.

- `In Progress`  
  - Tasks an agent or human is actively working on.
  - Multi-step workflow may be visible via tags (e.g., `outline`, `draft`, `media`).

- `Review (PR)`  
  - PR created in GitHub.
  - Awaiting checks, human review, or automated QA.

- `Publish`  
  - Approved; either published immediately or **scheduled** (via Gantt).

- `Completed`  
  - Published and integrated.
  - Follow-up analytics and internal-link tasks may still emerge later.

Columns map to a field like `status` on the `ContentTask`.

#### 3.1.2 Card Structure

Each card in the Kanban represents a `ContentTask`. Typical card layout:

- **Title**: Short description of the task, e.g., “Create guide: Hiking in Cinque Terre – Autumn Edition”.
- **Badges**:
  - Type: `article`, `update`, `cluster-expansion`, `event-coverage`, `fix`, `localization`, etc.
  - Priority: `low`, `medium`, `high`, `critical`.
  - Language(s).
- **Meta data**:
  - Associated sitemap page(s) and/or category.
  - Target publication window.
  - Assigned agent(s).
  - SEO keyword(s) or semantic theme(s).
- **GitHub**:
  - Linked issue and PR (if any).
  - CI/checks state badges.

#### 3.1.3 Interactions

- Drag cards between columns to update status.
- Inline edit fields, e.g., due date, priority, tags.
- Right-click / context menu:
  - “Open in Gantt timeline”
  - “Open in Graph view”
  - “Open GitHub issue”
  - “Open GitHub PR”
  - “View related sitemap pages”

---

### 3.2 Gantt View (shadcn Data Gantt)

The **Gantt timeline** is the **temporal backbone** of the planning system.

It shows **when** each task and its sub-phases happen.

#### 3.2.1 Time Model

Each `ContentTask` is rendered as a **Gantt bar** with potential sub-segments or sub-tasks for phases like:

- `planning`
- `research`
- `outline`
- `draft`
- `media`
- `internal-links`
- `review`
- `publish`

Time resolutions:

- Day
- Week
- Month
- Quarter

Zooming in/out allows granular or high-level views.

#### 3.2.2 Dependencies

Gantt supports dependencies, e.g.:

- Task B cannot start before Task A is ready.
- Internal-link updates must happen **after** a target page is updated.
- Localization tasks must follow after the primary language content is merged and deployed.

Dependencies are represented as connecting lines between bars.

#### 3.2.3 Interactions

- Drag entire bars to reschedule tasks.
- Resize bars to adjust duration.
- Split or merge phases of a task.
- Automatic re-scheduling modes:
  - **Strict**: prevent overlapping or impossible schedules.
  - **Flexible**: shift dependent tasks when one changes.
  - **Agent capacity-aware**: avoid overloading a virtual or human agent.

Context menu per bar:

- “Open task card” (Kanban)
- “Open in Graph view”
- “Open GitHub issue/PR”
- “Reschedule with AI” (e.g., let Editor-in-Chief agent optimize the schedule)

---

### 3.3 Graph View (ReactFlow)

The **Graph view** visualizes the **relationships** between:

- content tasks,
- sitemap pages,
- events/seasonality,
- SEO topics,
- internal links,
- and agents.

#### 3.3.1 Node Types

Typical nodes:

- `ContentTaskNode`  
- `PageNode` (from sitemap)  
- `CategoryNode`  
- `EventNode` (e.g., festival, conference, seasonal window)  
- `SEOKeywordNode` / `TopicClusterNode`  
- `AgentNode` (showing responsibility)

#### 3.3.2 Edges

Examples:

- `ContentTaskNode` → `PageNode`: this task affects this page.
- `ContentTaskNode` → `SEOKeywordNode`: content targets this keyword / cluster.
- `ContentTaskNode` → `EventNode`: content is tied to an event or season.
- `ContentTaskNode` → `AgentNode`: agent responsible for one or more phases.
- `PageNode` → `PageNode`: internal link relationship.

Graph view is used to:

- Understand cluster coverage and gaps.
- See which tasks are related to which events and pages.
- Highlight internal linking patterns or issues.

---

### 3.4 Detail & Inspector Panels

In all views, selecting a task/page opens an **inspector panel**, showing:

- Full YAML/JSON representation of the task.
- Associated GitHub artifacts.
- Linked sitemap nodes.
- Planned internal links and their current status.
- AI suggestions (SEO, refactors, experiments).

---

## 4. Data Model

The editorial plan is stored as a **file-based manifest**, typically:

- `content/editorial-plan.yaml` in the GitHub repo.

It is the canonical representation from which:

- Kanban view derives `ContentTask`s.
- Gantt view derives `TimelineTask`s.
- Graph view derives nodes and edges.

### 4.1 Conceptual Entities

- `EditorialPlan`
- `ContentTask`
- `TimelineTask`
- `LinkInstruction`
- `MediaRequirement`
- `DistributionPlan`
- `Event`
- `AgentAssignment`

### 4.2 Example `editorial-plan.yaml` (conceptual)

```yaml
version: 1
site_id: "cinque-terre-travel"
timeframe:
  start: "2025-01-01"
  end: "2025-12-31"

goals:
  - id: "seo_cinque_terre_autumn"
    description: "Own the topic of autumn travel in Cinque Terre"
    metrics:
      - type: "organic_traffic"
        target: 20000
      - type: "avg_position"
        keyword: "cinque terre autumn"
        target: 3

content_tasks:
  - id: "ct-autumn-guide-2025"
    title: "Ultimate Guide to Visiting Cinque Terre in Autumn 2025"
    type: "article"
    status: "planned"
    priority: "high"
    languages: ["en", "de", "it"]
    sitemap_targets:
      - "/guide/autumn"
    seo:
      primary_keyword: "cinque terre autumn"
      secondary_keywords:
        - "cinque terre in october"
        - "cinque terre weather autumn"
    events:
      - id: "autumn-season-2025"
    timeline:
      start: "2025-07-15"
      end: "2025-09-15"
      phases:
        - phase: "research"
          start: "2025-07-15"
          end: "2025-07-22"
          agent: "seo-agent"
        - phase: "outline"
          start: "2025-07-23"
          end: "2025-07-24"
          agent: "content-writer-1"
        - phase: "draft"
          start: "2025-07-25"
          end: "2025-07-31"
          agent: "content-writer-1"
        - phase: "media"
          start: "2025-08-01"
          end: "2025-08-05"
          agent: "media-agent"
        - phase: "internal-links"
          start: "2025-08-05"
          end: "2025-08-10"
          agent: "link-agent"
        - phase: "review"
          start: "2025-08-11"
          end: "2025-08-20"
          agent: "editor-in-chief"
        - phase: "publish"
          start: "2025-09-01"
          end: "2025-09-15"
          agent: "automation"
    internal_links:
      required_inbound:
        - "/destinations/cinque-terre"
        - "/themes/autumn-europe"
      required_outbound:
        - "/trails/sentiero-azzurro"
        - "/train-tickets"
    media_requirements:
      - type: "hero-image"
        count: 1
        style: "isometric-comic"
      - type: "gallery"
        count: 8
        style: "photo-realistic"
    distribution:
      social_snippets:
        - channel: "instagram"
          timing: "2025-09-05"
        - channel: "linkedin"
          timing: "2025-09-07"
      newsletter_feature:
        - issue: "2025-09"
    github:
      issue: 123
      pr: null
    analytics_followup:
      check_after_days: 30
      metrics:
        - type: "pageviews"
        - type: "time_on_page"
        - type: "scroll_depth"

events:
  - id: "autumn-season-2025"
    label: "Autumn Travel Season 2025"
    start: "2025-09-01"
    end: "2025-11-15"
    type: "season"
```

---

### 4.3 TypeScript Interfaces (simplified)

```ts
type ContentStatus =
  | "backlog"
  | "planned"
  | "in-progress"
  | "review"
  | "publish"
  | "completed";

type ContentType =
  | "article"
  | "update"
  | "cluster-expansion"
  | "event-coverage"
  | "fix"
  | "localization"
  | "other";

interface EditorialPlan {
  version: number;
  siteId: string;
  timeframe?: {
    start?: string;
    end?: string;
  };
  goals?: Goal[];
  contentTasks: ContentTask[];
  events?: Event[];
}

interface Goal {
  id: string;
  description: string;
  metrics?: GoalMetric[];
}

interface GoalMetric {
  type: string;
  keyword?: string;
  target?: number;
}

interface Event {
  id: string;
  label: string;
  type: "season" | "holiday" | "festival" | "launch" | "other";
  start: string;
  end: string;
  metadata?: Record<string, any>;
}

interface TimelinePhase {
  phase:
    | "planning"
    | "research"
    | "outline"
    | "draft"
    | "media"
    | "internal-links"
    | "review"
    | "publish";
  start: string;
  end: string;
  agent?: string;
}

interface Timeline {
  start: string;
  end: string;
  phases?: TimelinePhase[];
  dependencies?: string[]; // ids of other ContentTasks
}

interface LinkInstruction {
  requiredInbound?: string[]; // sitemap routes
  requiredOutbound?: string[];
}

interface MediaRequirement {
  type: string;
  count: number;
  style?: string;
  notes?: string;
}

interface DistributionSnippet {
  channel: string;
  timing: string;
  metadata?: Record<string, any>;
}

interface NewsletterFeature {
  issue: string; // e.g., "2025-09"
  priority?: "primary" | "secondary";
}

interface DistributionPlan {
  socialSnippets?: DistributionSnippet[];
  newsletterFeature?: NewsletterFeature[];
}

interface GithubMeta {
  issue?: number;
  pr?: number | null;
  labels?: string[];
  milestone?: string;
}

interface AnalyticsFollowup {
  checkAfterDays: number;
  metrics: { type: string; target?: number }[];
}

interface ContentTask {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  priority?: "low" | "medium" | "high" | "critical";
  languages?: string[];
  sitemapTargets?: string[]; // routes or page ids
  seo?: {
    primaryKeyword?: string;
    secondaryKeywords?: string[];
    topicClusterId?: string;
  };
  events?: string[]; // event ids
  timeline?: Timeline;
  internalLinks?: LinkInstruction;
  mediaRequirements?: MediaRequirement[];
  distribution?: DistributionPlan;
  github?: GithubMeta;
  analyticsFollowup?: AnalyticsFollowup;
}
```

---

## 5. Workflows

### 5.1 Weekly Planning Workflow

1. **Analytics Agent** produces:
   - Underperforming pages.
   - Emerging opportunities from search and behavior data.

2. **SEO Agent** proposes:
   - New `contentTasks` (backlog items).
   - Updates to existing `contentTasks`.

3. **Editor-in-Chief Agent**:
   - Selects tasks to move from `backlog` → `planned`.
   - Assigns time windows (Gantt) and agents.
   - Aligns tasks with events and seasons.

4. The **Kanban** and **Gantt** views update accordingly:
   - Tasks appear in `Planned` column.
   - Tasks get Gantt bars with defined phases.

---

### 5.2 Content Creation Workflow

1. Task is moved to `in-progress` in Kanban.
2. **Gantt** phases begin (e.g., research, outline, draft).
3. **Writer agent** generates outline & draft, with SEO agent validation.
4. **Media agent** creates or assigns visuals.
5. **Link agent** updates internal linking instructions and schedules link-fix PRs.
6. Task moves to `review`, PR is created.
7. After approval & checks, task moves to `publish`.
8. Gantt `publish` phase is executed (e.g., merge PR, trigger deployment).
9. Task moves to `completed`; analytics follow-up is scheduled.

---

### 5.3 Internal Linking & 404 Workflow

1. Link agent periodically:
   - Scans sitemap & editorial plan.
   - Detects 404s, missing links, or orphaned pages.
   - Creates `ContentTask`s of type `fix` or `update`.

2. These tasks:
   - Ensure `requiredInbound` and `requiredOutbound` links are satisfied.
   - Generate PRs that update markdown/HTML content or configuration.

3. Gantt ensures link tasks run **after** main content tasks where necessary.

---

### 5.4 Localization Workflow

1. Primary language task (e.g., EN) is planned and completed first.
2. Localization agent creates secondary `ContentTask`s for other languages:
   - Type `localization`.
   - Dependent on the primary task (via timeline dependencies).
3. Gantt ensures translations are scheduled after the main content is stable.
4. Kanban tracks localization tasks independently (can be in progress while original is in review or publish).

---

### 5.5 Analytics-driven Optimization

1. After `checkAfterDays`, Analytics Agent:
   - Checks metrics vs targets.
   - If performance is poor or trending down:
     - Creates or updates `ContentTask` of type `update`.
2. Update tasks:
   - Adjust copy, structure, CTAs, internal links, and media.
   - Refresh publishing date if relevant.

---

## 6. Technical Architecture

### 6.1 Frontend Stack

- **TypeScript + React**
- **Vite** for bundling
- **Zustand** for state management
- **shadcn/ui** for UI components:
  - Data Kanban
  - Data Gantt
  - Inputs, dialogs, forms, etc.
- **ReactFlow** for graph view
- **React Hook Form** for editorial-form editing
- **Tailwind CSS** for styling

### 6.2 Persistence & Sync

- **Source of truth**:  
  `editorial-plan.yaml` and other config/content files in a **GitHub repository**.

- **Local caching**:  
  **DuckDB WASM** in the browser to:
  - Efficiently query tasks.
  - Aggregate analytics and metrics.
  - Support offline or low-latency interactions.

- **Sync layer**:
  - Client app fetches and pushes changes via:
    - GitHub REST / GraphQL API.
    - Branch/PR-based changes for plan edits.
  - Optionally, a light backend proxy to handle auth and rate limits.

### 6.3 Agents & MCP

- Agents run via MCP servers and OpenAI API.
- They read/write:
  - `editorial-plan.yaml`
  - `sitemap.yaml`
  - content markdown/MDX files
- They create or update GitHub Issues/PRs based on plan entries.

Typical interactions:

- “SEO agent: propose 10 new tasks for next month”  
- “Link agent: check integrity and update `internalLinks` for all tasks affecting `/guide/autumn`.”
- “Editor-in-chief: auto-schedule selected tasks into the Gantt timeline.”

### 6.4 GitHub Integration

- Each `ContentTask` can map to:
  - One GitHub Issue (discussion, acceptance criteria).
  - Zero or more PRs (implementation).
- Labels on GitHub Issues mirror:
  - Type (article, update, fix…)
  - Status (planned, in-progress, review, etc.)
- GitHub Milestones align with:
  - Weekly or monthly editorial sprints.
  - Gantt’s higher-level groupings.

Webhooks:

- Update Kanban status when PR is merged.
- Update Gantt progress when checks pass/fail.
- Trigger agents on events (e.g., “PR merged” → “schedule analytics follow-up”).

---

## 7. Non-functional Requirements

- **Resilience**:  
  Editorial plan is file-based; corruption is minimized via Git history.

- **Auditability**:  
  All changes are PR-based and code-reviewed.

- **Extensibility**:  
  New agents and new task types can be added by extending the YAML schema.

- **Multi-tenant friendliness**:  
  Each site can have its own `editorial-plan.yaml` or multiple plans for different verticals.

- **Human override**:  
  Humans can always override or adjust agent-suggested scheduling and tasks.

---

## 8. Reference Schema — `editorial-plan.schema.yaml`

Below is a **reference JSON Schema expressed in YAML** for validating `editorial-plan.yaml`.  
(This is a starting point and can be extended as needed.)

```yaml
$schema: "https://json-schema.org/draft/2020-12/schema"
$title: "Editorial Plan Schema"
$type: object
$defs:
  contentStatus:
    type: string
    enum:
      - backlog
      - planned
      - in-progress
      - review
      - publish
      - completed

  contentType:
    type: string
    enum:
      - article
      - update
      - cluster-expansion
      - event-coverage
      - fix
      - localization
      - other

  priority:
    type: string
    enum:
      - low
      - medium
      - high
      - critical

  goalMetric:
    type: object
    properties:
      type:
        type: string
      keyword:
        type: string
      target:
        type: number
    required: [type]
    additionalProperties: true

  goal:
    type: object
    properties:
      id:
        type: string
      description:
        type: string
      metrics:
        type: array
        items:
          $ref: "#/$defs/goalMetric"
    required: [id, description]
    additionalProperties: false

  event:
    type: object
    properties:
      id:
        type: string
      label:
        type: string
      type:
        type: string
        enum: [season, holiday, festival, launch, other]
      start:
        type: string
        format: date
      end:
        type: string
        format: date
      metadata:
        type: object
        additionalProperties: true
    required: [id, label, type, start, end]
    additionalProperties: false

  timelinePhase:
    type: object
    properties:
      phase:
        type: string
        enum:
          - planning
          - research
          - outline
          - draft
          - media
          - internal-links
          - review
          - publish
      start:
        type: string
        format: date
      end:
        type: string
        format: date
      agent:
        type: string
    required: [phase, start, end]
    additionalProperties: false

  timeline:
    type: object
    properties:
      start:
        type: string
        format: date
      end:
        type: string
        format: date
      phases:
        type: array
        items:
          $ref: "#/$defs/timelinePhase"
      dependencies:
        type: array
        items:
          type: string
    required: [start, end]
    additionalProperties: false

  linkInstruction:
    type: object
    properties:
      requiredInbound:
        type: array
        items:
          type: string
      requiredOutbound:
        type: array
        items:
          type: string
    additionalProperties: false

  mediaRequirement:
    type: object
    properties:
      type:
        type: string
      count:
        type: integer
        minimum: 1
      style:
        type: string
      notes:
        type: string
    required: [type, count]
    additionalProperties: false

  socialSnippet:
    type: object
    properties:
      channel:
        type: string
      timing:
        type: string
        format: date
      metadata:
        type: object
        additionalProperties: true
    required: [channel, timing]
    additionalProperties: false

  newsletterFeature:
    type: object
    properties:
      issue:
        type: string
      priority:
        type: string
        enum: [primary, secondary]
    required: [issue]
    additionalProperties: false

  distributionPlan:
    type: object
    properties:
      socialSnippets:
        type: array
        items:
          $ref: "#/$defs/socialSnippet"
      newsletterFeature:
        $ref: "#/$defs/newsletterFeature"
    additionalProperties: false

  githubMeta:
    type: object
    properties:
      issue:
        type: integer
      pr:
        type: integer
      labels:
        type: array
        items:
          type: string
      milestone:
        type: string
    additionalProperties: false

  analyticsMetric:
    type: object
    properties:
      type:
        type: string
      target:
        type: number
    required: [type]
    additionalProperties: false

  analyticsFollowup:
    type: object
    properties:
      checkAfterDays:
        type: integer
        minimum: 1
      metrics:
        type: array
        items:
          $ref: "#/$defs/analyticsMetric"
    required: [checkAfterDays, metrics]
    additionalProperties: false

  contentTask:
    type: object
    properties:
      id:
        type: string
      title:
        type: string
      type:
        $ref: "#/$defs/contentType"
      status:
        $ref: "#/$defs/contentStatus"
      priority:
        $ref: "#/$defs/priority"
      languages:
        type: array
        items:
          type: string
      sitemapTargets:
        type: array
        items:
          type: string
      seo:
        type: object
        properties:
          primaryKeyword:
            type: string
          secondaryKeywords:
            type: array
            items:
              type: string
          topicClusterId:
            type: string
        additionalProperties: false
      events:
        type: array
        items:
          type: string
      timeline:
        $ref: "#/$defs/timeline"
      internalLinks:
        $ref: "#/$defs/linkInstruction"
      mediaRequirements:
        type: array
        items:
          $ref: "#/$defs/mediaRequirement"
      distribution:
        $ref: "#/$defs/distributionPlan"
      github:
        $ref: "#/$defs/githubMeta"
      analyticsFollowup:
        $ref: "#/$defs/analyticsFollowup"
    required: [id, title, type, status]
    additionalProperties: false

type: object
properties:
  version:
    type: integer
  site_id:
    type: string
  timeframe:
    type: object
    properties:
      start:
        type: string
        format: date
      end:
        type: string
        format: date
    additionalProperties: false
  goals:
    type: array
    items:
      $ref: "#/$defs/goal"
  content_tasks:
    type: array
    items:
      $ref: "#/$defs/contentTask"
  events:
    type: array
    items:
      $ref: "#/$defs/event"
required:
  - version
  - site_id
  - content_tasks
additionalProperties: false
```

---

**End of Specification.**
