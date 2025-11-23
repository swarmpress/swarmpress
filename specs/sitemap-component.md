# Agentic Website Framework Editor Vision & Technical Specification

## Vision

The goal is to build a **next‑generation, agentic, graph‑driven website
editor** that merges a fully autonomous content engine with a
beautifully intuitive visual UI. The system turns the traditionally
rigid CMS paradigm into a dynamic, self‑evolving ecosystem where agents,
editors, and automated processes collaborate through a unified graph
model.

At its core, the platform visualizes and manages: - The **Sitemap
Graph** (pages and relationships) - **Internal Linking Graph**
(SEO‑critical link structure) - **Component Blueprints** (page
layouts) - **Content Models** (atomic design system) - **AI‑driven
evolution** of the website

The result:\
A visual, intelligent, modular, future‑proof editor that redefines how
websites are created, maintained, and scaled.

------------------------------------------------------------------------

## Feature Description

### 1. Visual Sitemap Graph Editor (React Flow)

-   Drag‑and‑drop hierarchy of all pages
-   Collapsible sections & clusters
-   Page status indicators (planned, draft, published, outdated)
-   Node details sidebar (metadata, SEO profile, tasks)
-   Auto‑layout for large sites
-   In‑graph creation of new pages

### 2. Internal Linking Intelligence Layer

-   Overlay internal links on the sitemap graph
-   Visualize link strength, quality, and anchor distributions
-   Inline link inspector for text components
-   Automated 404 detection and repair suggestions
-   AI‑generated link opportunities
-   Internal link equity scoring

### 3. Page Blueprint & Layout Designer

-   Build page templates using draggable component nodes
-   Define component order, props, and conditional logic
-   Validate required content fields per blueprint
-   Multi‑tenant theme overrides
-   Instant preview of component composition

### 4. Content Model Builder (Atomic Design)

-   Define atoms, molecules, organisms visually
-   Connect component dependencies
-   Generate JSON schemas automatically
-   Blueprint‑aware component selection

### 5. Agentic Collaboration Engine

-   Agents read/write to the graph
-   Automated proposals as GitHub PRs
-   Editorial workflow with AI suggestions
-   Task queue embedded inside sitemap nodes
-   Freshness scoring and content decay detection

### 6. Multi‑Language & Multi‑Tenant Support

-   Locale binding per node
-   Tenant overrides for components, layouts, content
-   Shared vs. tenant‑specific page variants

### 7. Analytics Feedback Loop

-   Traffic overlays on the sitemap graph
-   Orphan page detection
-   Keyword ranking insights
-   Automated adjustments for underperforming pages

------------------------------------------------------------------------

## Technical Specification

### Technology Stack

-   **Frontend**: React, TypeScript, Vite
-   **UI Library**: shadcn/ui
-   **State Management**: Zustand
-   **Graph Engine**: React Flow (custom nodes & edges)
-   **Persistence**: GitHub‑backed file‑based graphs + optional DuckDB
    WASM
-   **Content Renderer**: Astro
-   **AI Agents**: MCP Servers communicating via structured YAML/JSON
-   **File Formats**:
    -   `sitemap.yaml`
    -   `blueprints/*.yaml`
    -   `models/*.yaml`
    -   `content/*.md`
    -   `links.graph.json`

------------------------------------------------------------------------

### Data Model Overview

#### 1. Sitemap Node Structure

``` yaml
slug: /cinque-terre/vernazza/
title: Vernazza Guide
status: published
page_type: village_guide
topics: [vernazza, cinque-terre]
priority: high

internal_links:
  incoming: []
  outgoing: []

seo_profile:
  primary_keyword: "vernazza travel guide"
  freshness_score: 82

tasks:
  - type: refresh-content
    assigned_to: content_agent
```

#### 2. Page Blueprint Structure

``` yaml
page_type: village_guide
components:
  - type: Hero
    props: { title: "{{ title }}", image: "{{ hero_image }}" }
  - type: Facts
    props: { population: "{{ population }}" }
  - type: Gallery
    data_source: media.gallery
```

#### 3. Text Component Structure

``` yaml
id: intro_text
content: "Vernazza is one of the most iconic villages..."
links:
  - anchor: "Cinque Terre"
    target: /cinque-terre/
    offset: 34
```

------------------------------------------------------------------------

### Core Application Architecture

#### React Flow Layers

-   **Layer 1:** Sitemap Graph\
-   **Layer 2:** Internal Link Overlay\
-   **Layer 3:** Blueprint Graph\
-   **Layer 4:** Content Model Graph\
    All share the same node/edge architecture.

#### Zustand State Shape

``` ts
{
  sitemapGraph: GraphState,
  blueprintGraph: GraphState,
  modelsGraph: GraphState,
  selectedNode: Node | null,
  ui: {
    sidebarOpen: boolean,
    activePanel: "sitemap" | "blueprint" | "models"
  }
}
```

#### MCP Agent Interactions

-   Agents modify YAML/JSON files in the repository
-   Proposals become GitHub PRs
-   Editor visualizes PR changes directly in React Flow
-   Agents run:
    -   Link audits
    -   Content decay scans
    -   Blueprint validation
    -   SEO scoring
    -   Orphan page detection

------------------------------------------------------------------------

### File Synchronization Flow

1.  User edits sitemap via React Flow\
2.  Graph saves → generates `sitemap.yaml`\
3.  Agents consume YAML\
4.  Agents generate/update content files\
5.  PRs flow back into UI\
6.  UI allows reviewing diff inside the graph

------------------------------------------------------------------------

### DX & UX Highlights

-   Inline AI suggestions directly inside component nodes
-   Command palette (`cmd+k`) with actions:
    -   "Create new page"
    -   "Generate internal links"
    -   "Optimize blueprint"
-   One‑click "auto‑organize" graph layout
-   Context‑aware sidebars
-   Seamless preview in Astro

------------------------------------------------------------------------

### Scalability Considerations

-   Virtualized nodes for large sitemaps\
-   On‑demand loading of subgraphs\
-   Cached graph computation\
-   Shared component registry across tenants

------------------------------------------------------------------------

## Other

🚀 1. SMART SITEMAP INTELLIGENCE

The sitemap becomes dynamic and self-improving.

1.1 Content Opportunities (AI-Generated)

Agents flag missing content opportunities and add suggestions to the sitemap:

suggestions:
  - slug: /cinque-terre/vernazza/best-photo-spots/
    reason: "High search volume + missing competitor content"
    keywords:
      - vernazza photo spots
      - cinque terre photography
    estimated_value: high

1.2 Content Decay Tracking

Each page contains an aging mechanism:

freshness_score: 72
last_verified_content: 2025-07-15
requires_update_after: 90d


Agents regularly scan content and update the freshness score.

1.3 Competitor Comparison

Store competitor pages relevant to each node:

competitors:
  - domain: lonelyplanet.com
    url: /italy/cinque-terre/vernazza
  - domain: earthtrekkers.com


Agents compare gaps and propose improvements.

⚙️ 2. AGENTIC WORKFLOW AUTOMATION
2.1 Page Lifecycle Management

Each node includes a lifecycle stage:

status: draft | planned | published | needs-update | deprecated


Agents know exactly what to work on next.

2.2 Task Queue Embedded in Sitemap

The sitemap itself is a task scheduler.

tasks:
  - type: generate-content
    assigned_to: content_editor
  - type: optimize-images
    assigned_to: media_agent
  - type: check-seo
    assigned_to: seo_agent

2.3 Multi-Agent Ownership

Different agents own different parts of the same page:

owners:
  content: anna
  seo: julia
  imagery: marc
  social: liam


This connects directly to PR review rules.

🎨 3. COMPONENT AWARENESS INSIDE THE SITEMAP

Instead of placing component blueprints only in page templates, you can embed component-level directives in the sitemap node:

component_overrides:
  Hero:
    image_style: "wide"
  Gallery:
    max_items: 12
  WeatherWidget:
    variant: "compact"


This enables:

different components per page

multi-tenant visual differences

seasonal variations

A/B test control

🧭 4. NAVIGATION & INTERNAL LINKING
4.1 Dynamically generated navigation trees

From sitemap:

navigation:
  primary: true
  order: 3


Navigation menus update automatically.

4.2 Internal Linking Hints

Agents auto-generate internal links based on relationships:

recommended_links:
  - /cinque-terre/hiking/
  - /cinque-terre/vernazza/
  - /cinque-terre/travel-tips/

4.3 Orphan Page Detection

If no incoming links → flag the node for attention.

🔍 5. SEO SUPERPOWERS
5.1 Keyword Intent Profile

Each page stores keyword clusters, search intent, and ranking difficulty:

seo_profile:
  primary_keyword: "vernazza travel guide"
  intent: informational
  secondary_keywords:
    - vernazza things to do
    - cinque terre villages
  search_volume: 14000
  serp_competition: medium


Agents know exactly what to optimize for.

5.2 SERP Monitoring

Pages can track SERP positions over time:

serp_ranking:
  google: 8
  bing: 12
  last_update: 2025-07-20


SEO agents automatically update and propose improvements.

🌍 6. MULTI-TENANT & MULTI-LANGUAGE SUPPORT
6.1 Locale variants

Each node carries translation metadata:

translations:
  en: /cinque-terre/vernazza/
  it: /cinque-terre/vernazza-it/
  de: /cinque-terre/vernazza-de/


Agents can generate missing translations and track parity.

6.2 Tenant overrides

Tenants can override only what differs:

tenants:
  siteA:
    overrides:
      components:
        Hero:
          title_color: blue
  siteB:
    disabled_components:
      - WeatherWidget

📊 7. ANALYTICS FEEDBACK LOOP
7.1 Traffic & Engagement Stats

Pages can store simplified analytics:

analytics:
  monthly_pageviews: 18200
  bounce_rate: 46
  avg_read_time: 4.2m

7.2 Traffic Anomalies

Agents detect anomalies:

alerts:
  - increase: 120%
    reason: external backlink
  - drop: -40%
    reason: SERP change


Agents adjust content automatically.

🧱 8. CONTENT MODEL ATTACHMENT

Each node can be linked to specific data models:

content_model: village_guide
schema_version: 2
data:
  village_name: Vernazza
  population: 852
  region: Liguria


Agents know what structured data is expected for that page.

🤖 9. AGENT COLLABORATION FEATURES
9.1 Planned Editorial Cycles

Sitemap entries can include upcoming events that require preparation:

seasonal:
  - event: "Summer Travel Season"
    deadline: 2025-05-01
    tasks:
      - update-weather-widget
      - refresh-hotel-prices

9.2 Multi-agent dependency graph

Agents know who they depend on:

dependencies:
  seo_after: content
  media_after: seo

🧬 10. VERSIONING & AUDITABILITY
10.1 Changelog Information

The sitemap can include historical metadata:

history:
  - date: 2025-07-01
    change: "Added gallery component"
  - date: 2025-07-05
    change: "Adjusted keyword profile"

10.2 Versions per tenant

Each tenant has its own sitemap branches.

🧠 In Short: Sitemap Becomes a Self-Aware Digital Editor

When enriched with these features, the sitemap becomes:

a task scheduler

an SEO planner

a content freshness monitor

a navigation manager

a multi-tenant content orchestrator

a home for structured content models

a planning tool for future content

a QA and anomaly detection system

a collaborative matrix for multiple agents

a history log and versioned blueprint

This is the missing piece that makes an agentic website framework truly autonomous.

Exemplary sitemap schema:

# SITEMAP SCHEMA SPECIFICATION
# Defines the structure for a fully agentic, graph-driven sitemap.
# Each entry represents a page node in the website graph.

type: object
required:
  - slug
  - title
  - status
  - page_type
  - seo_profile
  - internal_links

properties:

  #########################################
  # Core Page Identity
  #########################################

  slug:
    type: string
    description: "Canonical URL path of the page."

  title:
    type: string
    description: "Human-readable page title."

  page_type:
    type: string
    description: "Type of the page, used to bind a blueprint and content model."

  status:
    type: string
    enum: [planned, draft, published, outdated, deprecated]
    description: "Lifecycle state of the page."

  priority:
    type: string
    enum: [low, medium, high, critical]
    description: "Guide for agents when prioritizing work."

  topics:
    type: array
    items:
      type: string
    description: "Tags / categories that classify this page."

  created_at:
    type: string
    format: date-time

  updated_at:
    type: string
    format: date-time

  #########################################
  # Page Structure & Binding
  #########################################

  blueprint:
    type: string
    description: "Reference to the blueprint YAML defining component structure."

  content_model:
    type: string
    description: "Reference to a content model schema."

  component_overrides:
    type: object
    description: "Customize specific components on this page."
    additionalProperties:
      type: object
      description: "Name of component → props override"
      properties:
        props:
          type: object
          description: "Key-value overrides passed to the component."
        variant:
          type: string
          description: "Override component visual variant."

  #########################################
  # Internal Linking Graph
  #########################################

  internal_links:
    type: object

    properties:
      outgoing:
        type: array
        description: "Links *from* this page to other pages."
        items:
          type: object
          properties:
            to:
              type: string
              description: "Target page slug."
            anchor:
              type: string
              description: "Anchor text of the link."
            location:
              type: string
              description: "ID of text component the link appears in."
            confidence:
              type: number
              description: "AI confidence score for recommended links."

      incoming:
        type: array
        description: "Links *from other pages* to this page."
        items:
          type: object
          properties:
            from:
              type: string
            anchor:
              type: string

    required:
      - outgoing
      - incoming

  #########################################
  # SEO & Ranking
  #########################################

  seo_profile:
    type: object
    required:
      - primary_keyword
      - intent

    properties:
      primary_keyword:
        type: string
      secondary_keywords:
        type: array
        items:
          type: string
      intent:
        type: string
        enum: [informational, transactional, navigational, local]
      search_volume:
        type: number
      serp_competition:
        type: string
        enum: [low, medium, high]
      canonical:
        type: string
      meta_description:
        type: string

      freshness_score:
        type: number
        minimum: 0
        maximum: 100
        description: "Calculated content freshness value."

      requires_update_after:
        type: string
        description: "Duration string, e.g. '90d'."

  #########################################
  # Multi-Language & Multi-Tenant
  #########################################

  translations:
    type: object
    description: "Mapping of locale → slug"
    additionalProperties:
      type: string

  tenants:
    type: object
    description: "Overrides per tenant."
    additionalProperties:
      type: object
      properties:
        overrides:
          type: object
          description: "Override specific blueprint or component fields."
        disabled_components:
          type: array
          items:
            type: string

  #########################################
  # Agents & Task System
  #########################################

  owners:
    type: object
    description: "Which agent owns which part of this page."
    properties:
      content:
        type: string
      seo:
        type: string
      media:
        type: string
      social:
        type: string

  tasks:
    type: array
    description: "Pending tasks related to this page."
    items:
      type: object
      properties:
        type:
          type: string
          description: "Task type, e.g. 'refresh-content', 'optimize-images'."
        assigned_to:
          type: string
        status:
          type: string
          enum: [open, in-progress, done]
        created_at:
          type: string
        due_at:
          type: string

  #########################################
  # Competitor Intelligence
  #########################################

  competitors:
    type: array
    items:
      type: object
      properties:
        domain:
          type: string
        url:
          type: string
        notes:
          type: string

  #########################################
  # AI Suggestions & Machine Intelligence
  #########################################

  suggestions:
    type: array
    description: "AI-generated suggestions for new pages or improvements."
    items:
      type: object
      properties:
        suggestion_type:
          type: string
          enum: [new_page, improve_content, add_links, update_blueprint]
        reason:
          type: string
        estimated_value:
          type: string
          enum: [low, medium, high]
        proposed_slug:
          type: string
        keywords:
          type: array
          items:
            type: string

  #########################################
  # Analytics Signals
  #########################################

  analytics:
    type: object
    properties:
      monthly_pageviews:
        type: number
      bounce_rate:
        type: number
      avg_read_time:
        type: number
      last_traffic_update:
        type: string

  alerts:
    type: array
    description: "Automatically detected anomalies."
    items:
      type: object
      properties:
        type:
          type: string
          enum: [traffic_increase, traffic_drop, serp_change, anomaly]
        value:
          type: number
        reason:
          type: string

  #########################################
  # History / Audit Log
  #########################################

  history:
    type: array
    items:
      type: object
      properties:
        date:
          type: string
        change:
          type: string
        agent:
          type: string
        details:
          type: string

# BLUEPRINT SCHEMA SPECIFICATION
# Defines how page templates (blueprints) are structured and validated.

type: object
required:
  - page_type
  - components

properties:

  #########################################
  # Page Type
  #########################################

  page_type:
    type: string
    description: "Corresponds to sitemap.page_type. Used to bind content + layout."

  description:
    type: string
    description: "Human-readable description of the purpose of this blueprint."

  version:
    type: string
    description: "Version of this blueprint (for handling breaking changes)."

  #########################################
  # Layout & Structure
  #########################################

  layout:
    type: string
    description: "Name of the Astro layout / wrapper component to use."

  components:
    type: array
    description: "Ordered list of components used in this page blueprint."
    items:
      type: object
      required:
        - type
      properties:

        #########################################
        # Component Identity
        #########################################

        type:
          type: string
          description: "Component name (matches an Astro/React component)."

        variant:
          type: string
          description: "Optional variant of the component."

        #########################################
        # Data Binding / Props
        #########################################

        props:
          type: object
          description: "Static or dynamic properties for the component."
          additionalProperties:
            type: string
            description: |
              Supports:
              - static values ("Hello World")
              - mustache-style bindings ("{{ title }}")
              - model references ("model.population")
              - AI-generated fields ("ai.summary")

        data_source:
          type: string
          description: |
            Optional reference to data from content models or external integrations.
            Example: "media.gallery" or "poi.list".

        required_fields:
          type: array
          description: "Content fields that must exist for this component to render."
          items:
            type: string

        optional_fields:
          type: array
          description: "Content fields that enrich the component but are not required."
          items:
            type: string

        #########################################
        # Conditional Display Logic
        #########################################

        show_if:
          type: object
          description: "Rules that determine whether this component should appear."
          properties:
            equals:
              type: object
            not_equals:
              type: object
            exists:
              type: array
              items: string

        #########################################
        # Component-Level Internal Linking Logic
        #########################################

        linking_rules:
          type: object
          description: "Internal linking constraints for components containing text."
          properties:
            min_links:
              type: number
            max_links:
              type: number
            must_link_to_page_type:
              type: array
              items: string
            forbidden_slugs:
              type: array
              items: string

        #########################################
        # AI Agent Hints (super important)
        #########################################

        ai_hints:
          type: object
          description: "Guidance for AI content generation specific to this component."
          properties:
            purpose:
              type: string
            tone:
              type: string
            include_keywords:
              type: array
              items: string
            avoid_phrases:
              type: array
              items: string
            word_count:
              type: number
            structure:
              type: string
              description: "Markdown structure or narrative pattern."

        #########################################
        # Tenant Overrides (component-level)
        #########################################

        tenant_overrides:
          type: object
          description: "Allow tenants to override props, variants, or visibility."
          additionalProperties:
            type: object
            properties:
              variant:
                type: string
              props:
                type: object
              disabled:
                type: boolean

  #########################################
  # Blueprint-Level Linking Rules
  #########################################

  global_linking_rules:
    type: object
    description: "Rules applied for internal linking across the entire page."
    properties:
      min_total_links:
        type: number
      max_total_links:
        type: number
      must_link_to_topical_cluster:
        type: boolean
      must_link_to_parent_section:
        type: boolean

  #########################################
  # Multi-Tenant Support
  #########################################

  tenants:
    type: object
    description: "Per-tenant blueprint overrides."
    additionalProperties:
      type: object
      properties:
        layout:
          type: string
        components:
          type: array
          description: "Tenant-specific component list (override or extend)."
        css_overrides:
          type: object
          additionalProperties:
            type: string

  #########################################
  # Blueprint Validation & Health
  #########################################

  validation:
    type: object
    properties:
      schema_version:
        type: string
      strict:
        type: boolean
        description: "If true, missing required fields = render error."
      allow_fallbacks:_





# CONTENT MODEL SCHEMA SPECIFICATION
# Describes the structure of reusable content models used by pages & components.
# Works together with:
# - sitemap.schema.yaml  (what pages exist)
# - blueprint.schema.yaml (how pages are composed)
# - content models (what structured data fills components)

type: object
required:
  - id
  - name
  - kind
  - fields

properties:

  #########################################
  # Model Identity
  #########################################

  id:
    type: string
    description: "Unique ID of the content model (e.g. 'village_guide')."

  name:
    type: string
    description: "Human-readable name of the model."

  kind:
    type: string
    enum: [atom, molecule, organism, template]
    description: "Atomic design level of this model."

  description:
    type: string
    description: "Description of what this model represents."

  version:
    type: string
    description: "Semantic version for this model."

  #########################################
  # Core Fields
  #########################################

  fields:
    type: array
    description: "List of fields that define the model."
    items:
      type: object
      required:
        - id
        - label
        - type
      properties:

        id:
          type: string
          description: "Machine name of the field (e.g. 'population')."

        label:
          type: string
          description: "Human-readable label."

        type:
          type: string
          enum:
            - string
            - text
            - markdown
            - number
            - boolean
            - date
            - datetime
            - image
            - media
            - reference
            - list
            - object
          description: "Data type of the field."

        description:
          type: string
          description: "What this field is used for."

        required:
          type: boolean
          default: false

        localized:
          type: boolean
          default: false
          description: "If true, value can differ per locale."

        unique:
          type: boolean
          default: false
          description: "If true, value must be unique across instances."

        default:
          description: "Optional default value."
        
        ###################################
        # Validation Rules
        ###################################

        validations:
          type: object
          properties:
            min:
              type: number
            max:
              type: number
            min_length:
              type: number
            max_length:
              type: number
            regex:
              type: string
            in:
              type: array
              items: {}
            not_in:
              type: array
              items: {}
            required_if:
              type: object
              description: "Conditional requirement based on other fields."

        ###################################
        # Reference & Relation Fields
        ###################################

        reference:
          type: object
          description: "Used when type = 'reference' or 'list' of references."
          properties:
            model:
              type: string
              description: "Target model id."
            multiple:
              type: boolean
              default: false
            relation_type:
              type: string
              enum: [one-to-one, one-to-many, many-to-many]

        ###################################
        # List / Object Field Config
        ###################################

        items:
          type: object
          description: "Schema for list items when type = 'list'."
          properties:
            type:
              type: string
            fields:
              type: array
              items:
                type: object

        ###################################
        # AI Hints (Field-Level)
        ###################################

        ai_hints:
          type: object
          description: "How AI should generate or validate this field."
          properties:
            purpose:
              type: string
              description: "What this field should express (e.g. 'SEO title')."
            tone:
              type: string
            style:
              type: string
            min_words:
              type: number
            max_words:
              type: number
            must_include:
              type: array
              items: string
            avoid:
              type: array
              items: string
            structure:
              type: string
              description: "Format guidelines (e.g. 'bullet list', 'FAQ-style')."

        ###################################
        # UI & Editor Metadata
        ###################################

        ui:
          type: object
          description: "Hints for the editor UI."
          properties:
            widget:
              type: string
              description: "Suggested editor widget (e.g. 'textarea', 'markdown', 'image-picker')."
            group:
              type: string
              description: "Field group / section in UI."
            order:
              type: number
            help_text:
              type: string

  #########################################
  # Model-Level Relations
  #########################################

  relations:
    type: array
    description: "High-level relations to other models (for graphs, editors, agents)."
    items:
      type: object
      properties:
        name:
          type: string
        target_model:
          type: string
        type:
          type: string
          enum: [one-to-one, one-to-many, many-to-many]
        via_field:
          type: string
          description: "Field id that stores the relation, if applicable."

  #########################################
  # Computed Fields
  #########################################

  computed_fields:
    type: array
    description: "Fields derived from other fields or external data."
    items:
      type: object
      properties:
        id:
          type: string
        label:
          type: string
        source:
          type: string
          description: |
            Expression or reference for computing the value.
            Example: "concat(title, ' – ', subtitle)" or "ai.summary(body)".
        type:
          type: string
        cached:
          type: boolean
          default: true

  #########################################
  # Data Sources (Sync / Async)
  #########################################

  data_sources:
    type: array
    description: "External data integrations for this model."
    items:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum: [http, database, function, ai]
        description:
          type: string
        config:
          type: object
          description: "Connector-specific configuration."

  #########################################
  # Multi-Tenant Overrides
  #########################################

  tenants:
    type: object
    description: "Tenant-specific model overrides."
    additionalProperties:
      type: object
      properties:
        fields:
          type: array
          description: "Override or extend fields for the tenant."
          items:
            type: object
        ui:
          type: object
          description: "Tenant-specific UI hints or grouping."
          additionalProperties:
            type: string

  #########################################
  # AI Guidance at Model Level
  #########################################

  ai_guidance:
    type: object
    description: "Global AI instructions when generating an instance of this model."
    properties:
      persona:
        type: string
        description: "Voice/persona to use (e.g. 'local travel expert')."
      tone:
        type: string
      style:
        type: string
      content_strategy:
        type: string
        description: "High-level guidance (e.g. 'focus on practical tips, not history')."
      crosslink_strategy:
        type: string
        description: "How AI should link this model to others (clusters, hubs, etc.)."

  #########################################
  # Validation & Lifecycle
  #########################################

  validation:
    type: object
    properties:
      strict:
        type: boolean
      allow_unknown_fields:
        type: boolean
      schema_version:
        type: string

  lifecycle:
    type: object
    description: "Lifecycle rules for content instances."
    properties:
      review_after_days:
        type: number
      expire_after_days:
        type: number
      archivable:
        type: boolean

  #########################################
  # History / Audit Log
  #########################################

  history:
    type: array
    items:
      type: object
      properties:
        version:
          type: string
        date:
          type: string
        change:
          type: string
        agent:
          type: string
        details:
          type: string





