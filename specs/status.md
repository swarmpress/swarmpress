Below is a thorough, end-to-end plan to turn what you already have (site editor + page editor + cinqueterre.travel + themes/pages/collections) into a **coherent, fully agentic website system** with consistent “sound”, correct internal linking, and strict QA for links + media relevance.

---

## 1) What’s going wrong today (symptoms → root causes)

### A) “Component text is about Riomaggiore, but image is Caribbean”

**Root causes**

* Image selection happens **without hard constraints** (location/topic/keywords).
* Components are authored **locally**, but media is picked **globally** with weak context.
* No enforcement step that validates “image matches component intent”.

### B) “Only navigation links work; content links don’t”

**Root causes**

* Authors/agents don’t have a **reliable sitemap index** + canonical URLs/slugs.
* There’s no system-level rule: “Every content page must link to X internal pages when relevant.”
* No post-processing step that checks: *all internal references resolve to an existing page*.

### C) “Flow/sound isn’t consistent across the page”

**Root causes**

* Components are generated in isolation.
* No “page-level editor” agent that orchestrates tone, transitions, redundancy removal, and narrative pacing.

---

## 2) The architecture you want (agents + shared knowledge + validators)

Think in three layers:

### Layer 1: Shared website knowledge (single source of truth)

Create a **Website Knowledge Index** (WKI) that all agents can query.
Minimum contents:

* **Sitemap graph**: pages, collections, canonical URLs, slugs, hierarchy, language variants
* **Entity index**: villages (Riomaggiore, Manarola…), trails, POIs, beaches, stations, viewpoints, museums, etc.
* **Media index**: image/video assets with tags (location, category, season, rights/license, photographer, dominant colors optional)
* **Internal link rules**: allowed link targets per component type, and required link density ranges

> Key rule: **Agents never invent URLs.** They only choose from WKI.

### Layer 2: Generation agents (create/update content)

* **Page Orchestrator Agent** (page-level “director”)
* **Section/Component Writer Agent(s)** (per component type)
* **Internal Linking Agent** (adds/repairs contextual internal links)
* **Media Selector Agent** (chooses images/videos that fit component intent)

### Layer 3: Validation agents (block publication unless passing)

* **QA Agent: Links** (broken internal + external + media URLs)
* **QA Agent: Media relevance** (semantic match between component + image tags)
* **QA Agent: Editorial coherence** (tone, redundancy, transitions, CTA consistency)

---

## 3) Required modules/components to check carefully (what must exist in agent.press)

Here’s the “checklist” of components/modules that must participate:

### In the Site Editor

* **Sitemap Manager**

  * Unique IDs for pages/collections
  * Canonical URL generation
  * Redirect tracking (if slugs change)
* **Theme/Template Registry**

  * Defines allowed component types per template
  * Defines “page intent” (e.g., Village page vs Trail page)
* **Global Style Guide**

  * Voice & tone, formatting rules, multilingual conventions

### In the Page Editor

* **Component Schema**

  * Each component must expose:

    * `intent` (why it exists)
    * `required_inputs` (entities, location, season, audience)
    * `output_constraints` (length, format, headings)
    * `allowed_link_targets` (which sitemap nodes are appropriate)
    * `media_requirements` (must include 1 image tagged with village=X)
* **Page Context Object**

  * A structured object passed to every agent call:

    * page type, target audience, locale, season, reading level, key entities, nearby pages, conversion goal

### Content Collections

* POIs, Trails, Restaurants, Events, Beaches, Transport
* Must have consistent fields so agents can summarize and cross-link reliably

---

## 4) The core operational workflow (how a page becomes “agentic”)

### Step 0 — Build/refresh the Website Knowledge Index (WKI)

Triggered on:

* new page created
* slug changed
* collection item added/updated
* media added/updated

### Step 1 — Page Orchestrator produces a “Page Brief”

Inputs: page template + page context + related entities + WKI graph neighborhood
Outputs:

* page narrative outline
* component-by-component “micro-brief”
* required internal link targets (a short curated list)
* media requirements per component

### Step 2 — Component writers generate content (but can’t publish)

Each component receives:

* its micro-brief
* page brief summary
* allowed internal link targets list
* allowed media tags list

### Step 3 — Internal Linking Agent

* Ensures links are inserted into the **actual content body**
* Uses only canonical links from WKI
* Validates anchor text relevance

### Step 4 — Media Selector Agent

* Selects media strictly matching:

  * component entity (e.g., Riomaggiore)
  * component category (sights/trails/food)
  * locale/season (if needed)
* If no matching asset exists → returns “NEEDS_MEDIA” rather than guessing.

### Step 5 — QA Gate (must pass to publish)

* Broken links
* Missing internal links where required
* Media relevance mismatch
* Editorial coherence (page-level flow)

### Step 6 — Maintenance loop (continuous optimization)

Scheduled triggers:

* weekly: re-check external links
* daily: broken media references
* monthly: content freshness for time-sensitive pages (events, transport)

---

## 5) Prompt system: the “house rules” (applies to all agents)

You’ll get best results if every agent prompt starts with the same **non-negotiables**:

**Global invariants**

1. You must use **only** pages/URLs provided in `SITEMAP_INDEX`. Never invent URLs.
2. Every component must remain consistent with:

   * `PAGE_CONTEXT.intent`
   * `COMPONENT_CONTEXT.intent`
   * `STYLE_GUIDE.voice`
3. Media must match the component’s entity/location/topic tags.
4. If required info is missing, output a structured `NEEDS_INPUT` / `NEEDS_MEDIA` response (don’t hallucinate).

**Output invariants**

* Return structured JSON (or your app’s native format) including:

  * `content`
  * `links_used` (IDs from sitemap)
  * `media_used` (IDs from media library)
  * `assumptions` (if any)
  * `warnings`

---

## 6) Concrete prompt templates (drop-in skeletons)

### 6.1 Page Orchestrator Agent (the director)

**Purpose:** ensure flow, sound, and that each component contributes to the page story.

**Prompt skeleton**

* Role: “Senior travel editor + information architect”
* Inputs:

  * `PAGE_CONTEXT`
  * `STYLE_GUIDE`
  * `SITEMAP_INDEX` (local neighborhood + top-level)
  * `ENTITY_DATA` (the page’s main entity + relevant neighbors)
  * `TEMPLATE_COMPONENTS` (which components exist on this page)

**Must produce**

* `page_outline`
* `component_briefs[]` each with:

  * intent
  * key points (bullets)
  * required internal link targets (IDs)
  * forbidden topics (avoid redundancy)
  * media tags required

**Quality bar**

* Clear narrative progression:

  * orientation → highlights → practicals → deeper exploration → CTA

---

### 6.2 Component Writer Agent (per component type)

**Purpose:** create component text that fits the page and doesn’t drift.

**Prompt skeleton**

* Role: “Local travel copywriter with strict structure”
* Inputs:

  * `COMPONENT_CONTEXT` (type, intent, entity, audience, length)
  * `PAGE_BRIEF.summary`
  * `STYLE_GUIDE`
  * `ALLOWED_LINK_TARGETS` (subset of sitemap)
  * `REQUIRED_MEDIA_TAGS`

**Rules**

* No invented facts; only from `ENTITY_DATA` / `COLLECTION_DATA`.
* No invented links.
* Use “Cinque Terre voice” consistently (you define it once in STYLE_GUIDE).

**Return**

* `content` in component format
* `suggested_internal_links` (IDs + anchor text suggestions)

---

### 6.3 Internal Linking Agent (the linker)

**Purpose:** ensure content body links are real and contextually correct.

**Inputs**

* component HTML/markdown
* `SITEMAP_INDEX`
* `LINKING_POLICY` (min/max internal links per component type)
* `RELATED_ENTITIES`

**Rules**

* Replace plain mentions with links when appropriate:

  * villages, trails, transport, attractions
* Prefer “hub pages” (collection overview) when linking from beginner pages
* Avoid overlinking (cap per paragraph)

**Return**

* updated content
* links_used (page IDs)

---

### 6.4 Media Selector Agent (relevance enforcer)

**Purpose:** prevent “Caribbean image” problems.

**Inputs**

* component text + `COMPONENT_CONTEXT.entity`
* `MEDIA_INDEX` (with tags)
* `REQUIRED_MEDIA_TAGS`

**Rules**

* Only choose media where:

  * location tag matches (Riomaggiore == Riomaggiore)
  * category matches (sights/trails/food)
* If nothing matches: output `NEEDS_MEDIA` + required tags.

---

### 6.5 QA Agent: Broken Links (internal + media)

**Inputs**

* rendered page (or component list)
* `SITEMAP_INDEX` and current published routes
* media URLs / IDs

**Checks**

* internal: every referenced page ID exists + has canonical URL
* anchors: if using fragments (#), fragment exists
* media: every media reference resolves and returns 200 (or asset exists in storage)

**Return**

* PASS/FAIL
* list of issues with exact locations + recommended fixes

---

### 6.6 QA Agent: Media Relevance

**Inputs**

* component intent + entity + text
* selected media tags

**Checks**

* entity match (hard)
* topical match (soft)
* fallback rejection (if mismatch above threshold)

**Return**

* PASS/FAIL
* mismatch explanation (“image tagged Barbados/Beach doesn’t match Riomaggiore/Sights”)

---

### 6.7 QA Agent: Editorial Coherence

**Inputs**

* full page content (all components)
* style guide

**Checks**

* consistent voice
* repetitive paragraphs
* smooth transitions (end of section references next section)
* CTA alignment with page intent

**Return**

* suggested edits + rewritten transitions (if allowed)
* PASS/FAIL depending on strictness

---

## 7) “Sound and flow” guaranteed: add a final Page Polish pass

Even with orchestrator + component briefs, you’ll still benefit from a final agent:

### Page Polish Agent (last mile)

* rewrites only **connective tissue**:

  * intros, outros, section transitions
* does not alter factual content unless explicitly permitted
* ensures the page reads like a single author

This is the difference between “modular content” and “a page that sings”.

---

## 8) Implementation plan (phased, but complete)

### Phase 1 — Foundations (WKI + style guide + schemas)

* Implement WKI build/update triggers
* Normalize:

  * page IDs, canonical URLs, slugs
  * entity IDs across collections
  * media tagging model (location/category/license)
* Produce a single STYLE_GUIDE used everywhere

**Done when**

* Any agent can request: “give me allowed internal links for this page” and get deterministic results.

---

### Phase 2 — Page Orchestrator + Component briefs

* Orchestrator generates page outline + micro-briefs
* Component writers consume briefs

**Done when**

* A page generated twice produces consistent structure and tone.

---

### Phase 3 — Linking + Media selection enforcement

* Linking Agent inserts links in body
* Media Selector blocks mismatches and returns NEEDS_MEDIA when necessary

**Done when**

* No invented URLs
* No entity-mismatched images

---

### Phase 4 — QA gating (hard stop before publish)

* Link QA + Media relevance QA + Editorial QA
* “Fail → auto-fix loop”:

  * broken internal link → Linking Agent repair
  * wrong image → Media Selector re-pick or NEEDS_MEDIA
  * coherence issues → Page Polish adjusts transitions

**Done when**

* Publishing is impossible unless QA passes.

---

### Phase 5 — Continuous maintenance (agentic operations)

* Schedules:

  * daily: internal link integrity + missing assets
  * weekly: external link check
  * monthly: stale content detection (events/transport)

---

## 9) Acceptance criteria (so you can verify it’s working)

1. **Zero hallucinated internal URLs** (all links resolve to WKI IDs)
2. **Media mismatch rate < 1%** (ideally 0% because hard entity tags)
3. **Internal link coverage**

   * each content component includes 1–3 contextual internal links (policy-driven)
4. **Page coherence**

   * editorial QA returns PASS for tone + transitions
5. **Broken links**

   * internal: 0
   * media: 0
   * external: reported + optionally auto-removed/updated with warning

---

## 10) What I’d do next inside agent.press (very practical)

1. Add/verify the **Page Context Object** is passed into every agent call.
2. Build the **Sitemap Index + Entity Index + Media Index** as first-class data structures.
3. Implement the **Orchestrator → Component Writers → Linker → Media Selector → QA Gate** pipeline exactly once, then reuse it for every site.
4. Make the QA gate the only way content becomes “published”.

---

If you want, paste (or describe) the **current agent list** you have in agent.press (names + responsibilities) and the **component types** you use on cinqueterre.travel (e.g., Hero, Village Highlights, Sights Grid, Trail Teaser, FAQ, etc.). I’ll map them 1:1 into a prompt pack with:

* final system prompts per agent,
* required inputs/outputs per module,
* and strict QA policies per component type.
