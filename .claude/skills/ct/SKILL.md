---
name: ct
description: Oversight skill for the cinqueterre.travel website, which is autonomously managed by swarm.press agents. Use when configuring agents, reviewing agent-generated content, or intervening in the editorial workflow.
---

# Cinque Terre Editorial Oversight Guide

cinqueterre.travel is **autonomously managed by AI agents**. Your role is oversight, not operations. Agents research, write, edit, and publish content. You set direction, review their work, and intervene when needed.

---

## The Agentic Model: Agents Do the Work

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTONOMOUS CONTENT PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   AGENTS (Autonomous)                    YOU (Oversight)                    │
│   ───────────────────                    ──────────────                     │
│                                                                             │
│   WriterAgent                            Set Direction                      │
│   • Researches topics                    • Configure editorial voice        │
│   • Generates JSON content               • Define research parameters       │
│   • Follows editorial voice              • Set media guidelines             │
│   • Creates PRs for review                                                  │
│                                          Review & Approve                   │
│   EditorAgent                            • Review PRs (agent commits)       │
│   • Reviews WriterAgent output           • Approve/reject via Dashboard     │
│   • Requests revisions                   • Merge to publish                 │
│   • Approves for publishing                                                 │
│                                          Intervene When Needed              │
│   EngineeringAgent                       • Answer QuestionTickets           │
│   • Builds the site                      • Override agent decisions         │
│   • Deploys to production                • Manual edits (rare)              │
│   • Validates assets                                                        │
│                                                                             │
│   ──────────────────────────────────────────────────────────────────────    │
│   Agent commits → PR created → Review → Merge → Site rebuilds → Live        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Your Role is NOT to:
- Manually write content (agents do this)
- Edit JSON files directly (except for configuration)
- Manage day-to-day publishing (agents handle workflows)

### Your Role IS to:
- Configure how agents behave (editorial voice, research scope)
- Review agent-generated content via Pull Requests
- Answer agent questions via QuestionTickets
- Approve high-risk decisions (major content changes, new sections)
- Intervene when agents produce incorrect or off-brand content

---

## Two Systems of Record

Agents work across two systems:

| System | Contains | Agent Interaction |
|--------|----------|-------------------|
| **Git** (`cinqueterre.travel/`) | Actual content (JSON), agent configs | Agents commit content, create PRs |
| **PostgreSQL** (swarm.press) | Workflow state, tasks, reviews | Agents update status, log activities |

**Content flows through Git.** Agents generate JSON blocks, commit to branches, and create PRs. When you merge a PR, the site rebuilds.

**Workflow state lives in PostgreSQL.** Tasks, reviews, and agent activities are tracked in the database, visible via the Admin Dashboard.

---

## Configuring the Agents

Agent behavior is controlled via configuration files in the content repository. **This is your primary lever for directing agent output.**

### Configuration Files

| File | Purpose | What to Configure |
|------|---------|-------------------|
| `content/config/writer-prompt.json` | Editorial voice | Tone, persona (Giulia Rossi), style rules |
| `content/config/collection-research.json` | Research behavior | Search queries, extraction hints, schedules |
| `content/config/media-guidelines.json` | Image selection | Imagery style, search terms, brand guidelines |
| `content/config/blog-workflow.json` | Blog publishing | Categories, approval rules, scheduling |
| `content/config/agent-schemas.json` | Block documentation | Block types agents can use, with examples |

### Editorial Voice: Giulia Rossi

The WriterAgent speaks as **Giulia Rossi**, a local guide. This persona is defined in `writer-prompt.json`.

**Tone:**
- Warm & Personal — Like a friend sharing secrets
- Knowledgeable — Insider expertise without lecturing
- Practical — Actionable tips, not fluff
- Authentic — Honest about crowds and challenges

**Agent will produce:**
> "The trick to Via dell'Amore isn't just the view—it's the timing. Come at 7am before the cruise ships unload."

**Agent will NOT produce:**
> "Via dell'Amore offers stunning panoramic views and is a must-see attraction."

To adjust the voice, edit `writer-prompt.json`:
```json
{
  "website_prompt_template": {
    "capability": "write_draft",
    "variables_override": {
      "editorial_tone": "warm, knowledgeable, personal",
      "editor_name": "Giulia Rossi"
    }
  }
}
```

### Collection Research Configuration

The `collection-research.json` controls how agents research restaurants, hotels, hikes:

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
    "events": "daily"
  }
}
```

### Media Guidelines

The `media-guidelines.json` directs how MediaAgent selects imagery:

```json
{
  "style": "authentic, editorial, not stock-photo",
  "preferred_sources": ["unsplash", "local photographers"],
  "avoid": ["overly saturated", "tourist clichés", "crowded scenes"],
  "village_specific": {
    "riomaggiore": "dramatic cliffs, colorful buildings, harbor"
  }
}
```

---

## Reviewing Agent Output

Agents create Pull Requests for all content changes. **PR review is your primary quality control.**

### The Review Workflow

```
1. Agent generates content → commits to branch → creates PR
2. You receive notification (GitHub/Dashboard)
3. Review the PR diff (JSON changes)
4. Options:
   a. Approve & Merge → Content goes live
   b. Request Changes → Agent revises (via EditorAgent feedback)
   c. Reject → Content discarded, agent notified
```

### What to Check in Reviews

| Check | What to Look For |
|-------|------------------|
| **Voice** | Does it sound like Giulia? Warm, practical, authentic? |
| **Accuracy** | Are facts correct? Prices, hours, locations? |
| **LocalizedString** | Is `en` always present? Are translations reasonable? |
| **Block structure** | Are blocks well-formed? Right types for content? |
| **Brand alignment** | Does it fit the Cinque Terre Dispatch brand? |

### Using the Admin Dashboard

The Admin Dashboard (`http://localhost:4321`) provides:

| Feature | Use For |
|---------|---------|
| **Kanban Board** | See editorial tasks, track agent progress |
| **PR Review Panel** | Review pending agent PRs |
| **Collections Browser** | See what agents have populated |
| **Sitemap Graph** | Visualize site structure |
| **Deployment Panel** | Monitor publish status |

---

## Intervening: QuestionTickets

When agents are uncertain, they create **QuestionTickets** — escalations that require your input.

### Common QuestionTicket Scenarios

| Scenario | Agent Action | Your Response |
|----------|--------------|---------------|
| Ambiguous editorial direction | Ticket: "Should I include controversial restaurant?" | Provide guidance |
| Missing information | Ticket: "Cannot find opening hours for X" | Provide info or skip |
| Brand decision | Ticket: "Is this topic on-brand?" | Yes/No with reasoning |
| Conflict | Ticket: "Source A says X, Source B says Y" | Resolve conflict |

### Answering Tickets

Via Admin Dashboard or API:
1. View ticket details
2. Provide response
3. Agent continues with your guidance

**QuestionTickets are how agents learn your preferences.** Clear, consistent answers improve future agent output.

---

## Manual Intervention (When Necessary)

Sometimes you need to directly edit content. **This should be rare** — prefer configuring agents or providing feedback via reviews.

### When Manual Edits Are Appropriate

- Urgent corrections (factual errors, broken content)
- One-time overrides agents can't handle
- Initial content seeding before agents take over
- Configuration changes (agent configs, not content)

### Content Structure Reference

If you must edit manually, understand the structure:

**Village Configs:** `content/config/villages/{village}.json`
```json
{
  "slug": "riomaggiore",
  "hero": {
    "title": { "en": "Riomaggiore", "de": "...", "fr": "...", "it": "..." },
    "subtitle": { "en": "The easternmost jewel..." }
  },
  "intro": {
    "essentials": {
      "today": { "weather": "23°C", "seaTemp": "21°C", "sunset": "20:47" }
    }
  }
}
```

**Pages:** `content/pages/{page}.json` — Array of blocks
```json
{
  "body": [
    { "type": "editorial-hero", "title": { "en": "..." }, "badge": { "en": "Local Secrets" } },
    { "type": "paragraph", "markdown": "Content here..." }
  ]
}
```

**Collections:** `content/collections/{type}/{village}.json`
```json
{
  "items": [
    { "slug": "trattoria-la-lanterna", "name": { "en": "..." }, "rating": 4.5 }
  ]
}
```

### LocalizedString Pattern

All user-facing text uses LocalizedString. **English (`en`) is always required.**

```json
{
  "title": {
    "en": "Required English text",
    "de": "Optional German",
    "fr": "Optional French",
    "it": "Optional Italian"
  }
}
```

---

## The 5 Villages Reference

Agents need to understand each village's character. This is configured in village JSON files.

| Village | Character | Agents Emphasize |
|---------|-----------|------------------|
| **Riomaggiore** | The dramatic entrance | Colorful harbor, cliffs, Via dell'Amore |
| **Manarola** | The photographer's muse | Vineyard terraces, sunsets, wine |
| **Corniglia** | The hilltop hideaway | 382 steps, authenticity, no crowds |
| **Vernazza** | The postcard village | Harbor, castle, piazza life |
| **Monterosso** | The beach town | Sandy beaches, lemons, amenities |

---

## Summary: Your Oversight Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                     DAILY OVERSIGHT ROUTINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Check Dashboard                                            │
│      • Any pending PRs from agents?                             │
│      • Any QuestionTickets needing answers?                     │
│      • Any failed deployments?                                  │
│                                                                 │
│   2. Review Agent PRs                                           │
│      • Check voice, accuracy, structure                         │
│      • Approve, request changes, or reject                      │
│                                                                 │
│   3. Answer QuestionTickets                                     │
│      • Provide clear guidance                                   │
│      • Your answers train agent behavior                        │
│                                                                 │
│   4. Adjust Configs (as needed)                                 │
│      • Refine editorial voice                                   │
│      • Update research parameters                               │
│      • Adjust media guidelines                                  │
│                                                                 │
│   Agents handle the rest.                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

**Remember:** You are the Editor-in-Chief, not the writer. Configure the agents, review their work, answer their questions. Let them do the publishing.
