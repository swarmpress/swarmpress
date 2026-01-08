# Content Architecture

> **Last Updated:** 2026-01-08
> **Status:** Current

This document explains the swarm.press content architecture pattern, which separates operational metadata from content storage.

---

## Overview

swarm.press uses a **hybrid storage architecture**:

| Storage | Type | Purpose |
|---------|------|---------|
| **PostgreSQL** | Metadata | Agents, workflows, state, tasks, reviews |
| **Git Submodule** | Content | Pages, collections, agent configurations |
| **S3/Cloudflare R2** | Media | Images, videos, binary assets |

This separation enables:
- **Git version control** for all content changes
- **PR-based review** for content approval workflows
- **Theme decoupling** - same content, different presentations
- **Multi-language** support with structured JSON

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTENT ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│  DATABASE (PostgreSQL)          │  SITE REPO (Git Submodule) │
│  ─────────────────────────      │  ─────────────────────────  │
│  • Agent metadata               │  • Content JSON files       │
│  • Workflow state               │  • Collection items         │
│  • Editorial tasks              │  • Blog articles            │
│  • Review history               │  • Page content             │
│  • State machine audit          │  • Agent config files       │
│  • User permissions             │  • Village configurations   │
├─────────────────────────────────────────────────────────────┤
│  AGENT WORKFLOW:                                            │
│  WriterAgent → Create JSON → Git commit → PR → Review       │
│                                    ↓                        │
│                          Deploy on merge                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Content Submodule Structure

Each site has a Git submodule containing all content:

```
{site}.travel/content/
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

Content is stored as arrays of JSON blocks, not Markdown:

```json
{
  "id": "page-riomaggiore-overview",
  "slug": "riomaggiore/overview",
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
      "text": { "en": "Riomaggiore welcomes you like an old friend..." }
    },
    {
      "type": "places-to-stay",
      "village": "riomaggiore",
      "items": []
    }
  ]
}
```

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

1. **Task Assignment**: WriterAgent receives task from Temporal workflow
2. **Content Generation**: Agent generates JSON blocks using documented schemas
3. **Validation**: Blocks validated against Zod schemas (`validateContentBlocks`)
4. **Git Commit**: JSON committed to content submodule
5. **Pull Request**: PR created for human review
6. **Review**: EditorAgent or human reviews and approves
7. **Merge & Deploy**: PR merged triggers build and deployment

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

1. **Create Content Repository**
   ```bash
   mkdir mysite.travel
   cd mysite.travel
   git init
   mkdir -p content/{config,pages,collections}
   ```

2. **Add as Submodule**
   ```bash
   cd swarm-press
   git submodule add https://github.com/org/mysite.travel
   ```

3. **Create Agent Config**
   Copy and customize from `cinqueterre.travel/content/config/`:
   - `agent-schemas.json` - Usually shared
   - `writer-prompt.json` - Site-specific voice
   - `collection-research.json` - Site-specific collections

4. **Create Theme**
   ```bash
   cp -r packages/site-builder/src/themes/cinque-terre packages/site-builder/src/themes/mysite
   ```

5. **Update Theme Config**
   Configure `village-content.config.ts` to load from new submodule.

---

## Related Documentation

- [Architecture Overview](./overview.md) - High-level system architecture
- [Theme Development](../guides/theme-development.md) - Creating themes
- [GitHub Integration](./github-integration.md) - PR-based content review
- [CLAUDE.md](/CLAUDE.md) - Development guidelines
