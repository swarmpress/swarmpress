# Content Architecture

> **Last Updated:** 2026-05-12
> **Status:** Repo-canonical (post-migration). Verified end-to-end against the live cinqueterre.travel site.

This document explains the swarm.press content architecture pattern,
which separates operational metadata from content storage.

---

## Overview

swarm.press uses a **repo-canonical** storage architecture: each site's
GitHub repository is the single source of truth for its content.

| Storage | Holds | Notes |
|---------|-------|-------|
| **Site GitHub repo** | Pages, collections, agent configs, sitemap, site config | Canonical. Version-controlled. PR-reviewable. |
| **PostgreSQL** | Agents, workflows, state, tasks, reviews, audit log, outbox, prompt templates, schedules, websites registry | Operational metadata only — not content. |
| **S3 / Cloudflare R2** | Images, videos, binary assets | Referenced by URL from the site repo's JSON. |

The columns `content_items.body` and `collection_items.data` in
PostgreSQL are **deprecated** (nullable, no new writes); they exist
only for historical rows.

This separation enables:
- **Git version control** for all content changes
- **PR-based review** for content approval workflows (the editor literally
  reads + merges a PR)
- **Theme decoupling** — same content, different presentations
- **Multi-language** support with structured JSON
- **Multi-site at no extra cost** — each site is just another GitHub repo
  with its own Actions deploy workflow

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTENT ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│  DATABASE (PostgreSQL)              │  SITE GITHUB REPO         │
│  ─────────────────────────────      │  ───────────────────────── │
│  • Agents, capabilities, RBAC       │  • content/pages/*.json    │
│  • Workflow runs (Temporal records) │  • content/collections/**  │
│  • Editorial tasks & schedules      │  • content/config/**       │
│  • Reviews, question tickets        │  • Sitemap & site config   │
│  • State machine audit log          │  • .github/workflows/      │
│  • event_outbox (CloudEvents)       │    deploy.yml (per site)   │
│  • Prompt templates & bindings      │                            │
│  • Websites registry + GitHub creds │                            │
├─────────────────────────────────────────────────────────────────┤
│  AGENT WORKFLOW (verified end-to-end 2026-05-12):               │
│                                                                 │
│  brief.created (outbox → NATS)                                  │
│    → contentProductionWorkflow                                  │
│      → WriterAgent commits JSON to drafts/content-{id} branch   │
│        at content/pages/blog/{slug}.json                        │
│      → opens PR on the site repo                                │
│    → editorialReviewWorkflow                                    │
│      → EditorAgent reads draft from PR branch                   │
│      → approves → RepoClient merges PR (squash) to main         │
│  → push to main fires the site repo's deploy.yml                │
│  → Astro builds against monorepo theme + content/               │
│  → actions/deploy-pages publishes                               │
│  → Page live at /{lang}/blog/{slug}/                            │
└─────────────────────────────────────────────────────────────────┘
```

> **Path convention.** Drafts are not stored under a `drafts/` path —
> they live at their **final URL path** (e.g.
> `content/pages/blog/{slug}.json`) on a draft *branch*
> (`drafts/content-{id}`). This means the moment a PR merges, the file
> is already at the right path for the theme's `[lang]/blog/[slug].astro`
> route to render it.

---

## Site Repo Structure

Each site is its own GitHub repo. The platform reaches it via `RepoClient`
(per-website GitHub credentials in `websites.github_*` columns). For
`cinqueterre.travel` the repo is also embedded as a Git submodule for
local Astro development; that's a developer ergonomic, not an
architectural requirement.

```
{site}.travel/
├── .github/
│   └── workflows/
│       └── deploy.yml           # Owned by the site — builds Astro,
│                                # publishes via actions/deploy-pages
└── content/
    ├── config/                      # Agent configuration files
    │   ├── agent-schemas.json       # Block type documentation for agents
    │   ├── writer-prompt.json       # WriterAgent editorial voice override
    │   ├── collection-research.json # Research workflow configuration
    │   ├── blog-workflow.json       # Blog publishing workflow
    │   ├── media-guidelines.json    # MediaAgent imagery guidelines
    │   └── villages/                # Village-specific JSON configs
    │       ├── riomaggiore.json
    │       ├── manarola.json
    │       ├── corniglia.json
    │       ├── vernazza.json
    │       └── monterosso.json
    ├── pages/                       # Page content (JSON blocks)
    │   ├── index.json               # Homepage
    │   ├── blog/                    # Blog articles — agent-authored
    │   │   └── {slug}.json          # Routable at /{lang}/blog/{slug}/
    │   ├── village.json             # Village template
    │   └── {village}/               # Village-specific pages
    │       └── overview.json
    └── collections/                 # Collection data
        ├── restaurants/
        ├── accommodations/
        ├── hikes/
        └── events/
```

---

## JSON Block Format

Each page is a single JSON file in the site repo, structured as an array
of blocks (not Markdown). The file is the content — the database does
not store a parallel copy.

```json
{
  "id": "page-riomaggiore-overview",
  "slug": "riomaggiore/overview",
  "page_type": "village-overview",
  "body": [
    {
      "type": "editorial-hero",
      "title": { "en": "Riomaggiore", "de": "Riomaggiore", "fr": "Riomaggiore", "it": "Riomaggiore" },
      "subtitle": { "en": "The easternmost jewel of Cinque Terre..." },
      "image": "https://images.unsplash.com/...",
      "badge": "Village Guide"
    },
    {
      "type": "paragraph",
      "markdown": "Riomaggiore welcomes you like an old friend..."
    },
    {
      "type": "places-to-stay",
      "village": "riomaggiore",
      "items": []
    }
  ]
}
```

For agent-authored blog posts, the `slug` is a `LocalizedString` of the
form `/{lang}/blog/{slug}` so the same JSON file can drive the URLs in
every language.

### Block Type Categories

swarm.press includes 60+ block types with Zod validation:

| Category | Count | Examples |
|----------|-------|----------|
| **Core** | 10 | paragraph, heading, hero, image, gallery, quote, list, faq, callout, embed |
| **Marketing** | 20 | hero-section, feature-section, pricing-section, testimonial-section |
| **E-commerce** | 4 | product-list, product-overview, shopping-cart, promo-section |
| **Application UI** | 5 | card, data-table, form-layout, modal, alert |
| **Cinque Terre Theme** | 15 | village-selector, places-to-stay, eat-drink, featured-carousel |
| **Editorial** | 5 | editorial-hero, editorial-intro, editor-note, closing-note |
| **Template** | 9 | itinerary-hero, blog-article, weather-live, collection-with-interludes |

All block schemas are defined in `packages/shared/src/content/blocks.ts`.

---

## Multi-Language Support

All user-facing text uses the **LocalizedString** pattern:

```typescript
type LocalizedString = {
  en: string  // English (required)
  de?: string // German
  fr?: string // French
  it?: string // Italian
}
```

### Usage in JSON

```json
{
  "title": {
    "en": "Discover Riomaggiore",
    "de": "Entdecken Sie Riomaggiore",
    "fr": "Découvrez Riomaggiore",
    "it": "Scopri Riomaggiore"
  }
}
```

### Theme Routing

Multi-language routing is handled at the theme level:

```
/en/riomaggiore     # English
/de/riomaggiore     # German
/fr/riomaggiore     # French
/it/riomaggiore     # Italian
```

---

## Agent Configuration Files

Agents are configured per-site through JSON files in `content/config/`:

### agent-schemas.json
Documents all available block types for agents:
- Block descriptions
- Required/optional props
- Example usage
- Variant options

### writer-prompt.json
Overrides WriterAgent prompts with site-specific voice:
- Editorial persona (e.g., "Giulia Rossi")
- Tone guidelines
- Block type examples
- Collection prompts

### collection-research.json
Configures automated data gathering:
- Search queries per collection type
- Data extraction hints
- Quality requirements
- Research schedule

### blog-workflow.json
Defines the blog publishing workflow:
- Workflow steps (create → write → commit → PR → review → merge → deploy)
- PR template
- Content guidelines
- Automation settings

### media-guidelines.json
Guides MediaAgent for imagery:
- Village-specific search queries
- Brand visual identity
- Technical specifications
- Alt text guidelines

---

## Agent Workflow with Content

The full chain, as exercised against the live cinqueterre.travel repo
on 2026-05-12:

1. **Brief inserted** — a row in `content_items` (status=`brief_created`)
   plus a row in `event_outbox` (`brief.created`), in the same
   transaction.
2. **OutboxWorker** drains the outbox to NATS JetStream.
3. **EventTriggerService** subscribes to `brief.created`, starts
   `contentProductionWorkflow` with deterministic workflowId
   `content-production-{contentId}` (Temporal rejects duplicates —
   that's the idempotency guarantee).
4. **WriterAgent** generates JSON blocks against the documented
   block-type schemas, validates with `validateContentBlocks`, then
   commits via `RepoClient` to a draft branch (`drafts/content-{id}`)
   at the file's final URL path (`content/pages/blog/{slug}.json`).
5. **submit_for_review** opens a PR on the site repo. The PR description
   links back to the content item + the editorial review task.
6. **editorialReviewWorkflow** is started by the platform.
7. **EditorAgent** reads the draft from the PR branch (not from
   Postgres — the body column is deprecated), scores quality, and
   either approves, requests changes, or rejects.
8. **Merge or comment** — approve calls `RepoClient.mergePR` (squash);
   request_changes posts a PR review comment and opens a revision task;
   reject closes the PR and transitions content to `rejected`.
9. **Push to `main`** fires the site repo's `.github/workflows/deploy.yml`,
   which checks out the monorepo (for the Astro theme), checks out the
   site content, runs `astro build`, and publishes via
   `actions/deploy-pages@v4`.
10. **Page is live** at `/{lang}/blog/{slug}/` on the site's GitHub
    Pages domain (or custom domain).

```typescript
// Agent utilities (packages/agents/src/base/utilities.ts)
import { validateContentBlocks } from '@swarm-press/shared'

// Validate blocks before committing
const result = validateContentBlocks(blocks)
if (!result.valid) {
  throw new Error(`Invalid blocks: ${result.errors.join(', ')}`)
}
```

---

## Setting Up a New Site

1. **Create the site GitHub repo** with a `content/` directory and a
   `.github/workflows/deploy.yml` (copy from `cinqueterre.travel/.github/workflows/deploy.yml`).

2. **Register the website** in Postgres via the admin API, supplying
   the GitHub owner/repo and an installation token (or PAT). The token
   needs `repo` scope; if your `deploy.yml` lives in the site repo it
   also needs `workflow` scope to update it. See
   [Deployment Guide](../guides/deployment.md) for the `MONOREPO_PAT`
   pattern when the OAuth token is `workflow`-restricted.

3. **(Optional) Add as a submodule** of the monorepo for local Astro
   development:
   ```bash
   cd swarm-press
   git submodule add https://github.com/org/mysite.travel
   ```
   This is purely for `pnpm dev` against the theme — the platform itself
   reads from the GitHub repo via `RepoClient` and does not require it.

4. **Create per-site agent config** under `content/config/`. Copy and
   customize from `cinqueterre.travel/content/config/`:
   - `agent-schemas.json` — usually shared
   - `writer-prompt.json` — site-specific editorial voice
   - `collection-research.json` — site-specific collections

5. **Create a theme** in `packages/site-builder/src/themes/mysite/` (or
   reuse an existing one — themes are decoupled from content).

6. **Configure theme to read from the site repo's content/** by pointing
   its `pages/[...slug].astro` route at the appropriate `content/pages/`
   directory.

---

## Related Documentation

- [Architecture Overview](./overview.md) - High-level system architecture
- [Theme Development](../guides/theme-development.md) - Creating themes
- [GitHub Integration](./github-integration.md) - PR-based content review
- [CLAUDE.md](/CLAUDE.md) - Development guidelines
