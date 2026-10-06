# Construction kits: the product concept

> **Status:** reference concept, received from the owner on 2026-10-06. Decisions taken from it are
> in [ADR-0072](../adr/0072-site-blueprints-and-tool-graphs.md). The design for swarm.press, and how
> it is drawn in bricks, is [`docs/design/construction-kits.md`](../design/construction-kits.md).
>
> The owner decided (2026-10-06) that this is an **in-game layer**: the CEO and the staff build the
> blueprint and the tools inside the dollhouse. swarm.press stays a management sim; this is not a
> pivot to a website builder. The text below is the concept as received, lightly condensed (short
> lists are run together into sentences; no idea is dropped). Where it names product
> agents (Site Architect, Tool Architect…), swarm.press maps them onto staff roles (design §9).

---

## 1. Product Vision

**swarm.press** is an agentic website platform in which users visually define what a website is, how
it is structured, and what it can do — while AI generates and maintains the implementation.

The platform consists of two closely related construction environments:

1. **Website Construction Kit** — defines the information architecture, page types, blocks,
   relationships, content requirements, layout intent, and design system of a website.
2. **Tools Construction Kit** — defines executable tools and workflows that provide data, logic,
   automations, integrations, and agentic capabilities to the website.

The central idea is to separate **intent and structure** from implementation.

Users construct a semantic blueprint. AI turns that blueprint into production templates, components,
workflows, integrations, and code.

## 2. Core Product Model

swarm.press should treat the website and its tools as two connected graphs.

```text
Website Graph                     Tool Graph

Pages                             Tools
  ↓                                 ↓
Blocks  ───────────────────────→  Inputs
  ↓                                 ↓
Content/Data                      Operations
                                    ↓
                                  Connectors
                                    ↓
                                  Transformations
                                    ↓
                                  Outputs
```

A website block can consume content from a CMS, structured data, another block, or a tool output.

This makes the system more than a page builder or workflow builder. It becomes a **visual
specification environment for agentic websites**.

## 3. Website Construction Kit

### 3.1 Purpose

The Website Construction Kit is a visual environment for defining the structure and behavior of a
website without requiring the user to manually design or code every template.

It should answer questions such as:

- Which page types exist?
- How are pages related?
- Which blocks belong to each page type?
- What is each block supposed to accomplish?
- Which content or data does each block require?
- Which blocks are global, reusable, optional, or repeated?
- How should blocks behave across breakpoints?
- Which tools or dynamic data sources does a block depend on?
- Which design system and visual intent should be applied?

The result is a **semantic website blueprint**.

### 3.2 Website Blueprint Example

```text
Website
│
├── Home
│   ├── Header
│   ├── Hero
│   ├── Featured Story
│   ├── Article Feed
│   ├── Newsletter Signup
│   └── Footer
│
├── Article
│   ├── Article Header
│   ├── Article Body
│   ├── Author
│   ├── Related Articles
│   └── Footer
│
├── Topic
│   ├── Topic Header
│   ├── Article Feed
│   └── Footer
│
└── Author
    ├── Author Profile
    ├── Article Feed
    └── Footer
```

The visual canvas should allow the user to create, move, group, connect, inspect, and annotate these
objects.

### 3.3 Core Primitives

**Site.** The root object representing the complete website. Contains site metadata, navigation
model, global design rules, page types, global blocks, content models, tools, environments.

**Page Type.** A reusable page definition rather than an individual page (Home, Article, Topic,
Author, Search, Landing Page). Properties may include route pattern, source content type, required
fields, allowed blocks, navigation behavior, metadata rules, SEO rules.

**Block.** A semantic website component (Hero, Article Grid, Author Card, Search Box, Weather
Widget, Newsletter Signup). A block describes both **purpose and requirements**, not only
appearance.

```yaml
block: ArticleGrid
purpose: Display recent articles
source: Article[]
limit: 6
presentation: grid
columns:
  desktop: 3
  tablet: 2
  mobile: 1
```

**Global Block.** A block reused across multiple page types (Header, Footer, Cookie Consent, Global
Navigation).

**Collection.** A dynamic set of content or structured data (latest articles, featured stories,
products, authors, events).

**Relationship.** Defines how content and pages connect (Article → Author, Article → Topic, Topic →
Articles, Product → Category).

**Design Intent.** Visual and behavioral guidance attached to pages or blocks (editorial, dense,
minimal, cinematic, card-based, newspaper-like, image-heavy). Design Intent may include constraints
without requiring pixel-level design.

## 4. Website Creation Modes

**4.1 Blank.** The user creates the architecture manually. Best for users who already know the
desired structure.

**4.2 Describe.** The user explains the website in natural language, for example:

> Create an independent technology magazine with a homepage, article pages, topic pages, author
> pages, newsletter signup, search, and a daily featured story.

The agent creates a proposed blueprint that the user can inspect and modify visually
(Description → AI Architect → Proposed Website Blueprint → Visual Editing).

**4.3 Import.** The user imports an existing design or implementation: Claude Design, HTML, ZIP
export, existing website, repository, Figma, other design systems. The importer translates the
source into the native swarm.press semantic model.

## 5. Claude Design Integration

Claude Design should be treated as a first-class design source. The goal is not merely to reproduce
generated HTML: swarm.press should interpret Claude Design output and reconstruct its own semantic
website blueprint (Claude Design → Import / Connect → Design Interpreter → Semantic Reconstruction →
Website Blueprint).

### 5.1 Import from Claude Design

The importer should detect pages, sections, reusable components, layout hierarchy, navigation,
content placeholders, images and assets, design tokens, typography, spacing systems, responsive
behavior, likely content collections and likely dynamic areas.

### 5.2 Example Interpretation

A design that visually contains Header, Hero, Featured Story, a 3-column Article Grid, Newsletter
and Footer should be interpreted as:

```yaml
pageType: Home
blocks:
  - GlobalHeader
  - Hero:
      role: lead-story
  - ArticleCollection:
      role: featured
      query: featured = true
  - ArticleCollection:
      role: latest
      presentation: grid
      limit: 6
  - NewsletterSignup
  - GlobalFooter
```

The result becomes editable independently of the original Claude Design.

### 5.3 Claude Design Connection Modes

- **Mode A — File Import:** HTML, ZIP, assets, styles. The most robust first implementation.
- **Mode B — Connected Source:** if programmatic access permits it, the user connects swarm.press
  directly to Claude Design and picks a project to import.
- **Mode C — Roundtrip Design Workflow:** swarm.press Blueprint → Claude Design → Visual Changes →
  Re-import → Semantic Diff. The user makes design changes externally while swarm.press preserves
  the underlying semantic model.

### 5.4 Semantic Reconciliation

When a previously imported design changes, swarm.press should identify differences rather than
re-import the entire site blindly:

```text
Hero
✓ same semantic block
• typography changed
• image ratio changed from 16:9 to 3:2

Article Grid
✓ same data source
• columns changed from 3 to 4
• category labels added

New block detected
+ Editor's Picks

[ Apply All ] [ Review ]
```

This makes Claude Design an external visual editing surface while swarm.press remains the source of
truth for site structure.

## 6. AI Template Generation

The website blueprint should not contain implementation-specific code by default. AI generates the
implementation from it: templates, components, CSS / design tokens, responsive behavior, data
bindings, routing, SEO metadata. A block can therefore survive multiple implementations (React,
Astro, Next.js, server-rendered HTML, a future runtime) without changing its semantic definition.

## 7. Tools Construction Kit

### 7.1 Purpose

A visual environment for building executable functions and workflows that websites and agents can
use. It takes inspiration from n8n and Node-RED, but should be simpler, more semantic, and strongly
AI-assisted. Users should not need to understand low-level workflow plumbing unless they want to.

### 7.2 Tool Graph Example

```text
Weather Tool

[ Location Input ] → [ HTTP Request ] → [ Extract Fields ] → [ Normalize Data ] → [ Weather Output ]
```

The tool can then be used by a website block, another tool, an agent, a scheduled workflow, or an
API endpoint.

## 8. Core Tool Primitives

- **Tool:** a reusable executable capability (Get Weather, Search Articles, Translate Text, Send
  Newsletter, Generate Image, Summarize URL, Fetch Stock Price). It defines inputs, workflow, output
  schema, permissions, secrets, failure behavior.
- **Input:** information required by the tool (`city: {type: string, required: true}`). Inputs can
  originate from user interaction, website context, content data, another tool, an agent, a schedule.
- **Connector:** access to an external or internal service: HTTP, REST API, GraphQL, RSS, webhook,
  database, file, email, CMS, search, AI model.
- **Operation:** a deterministic processing step: map, filter, sort, merge, split, format, extract,
  transform, validate.
- **Condition:** controls workflow branching (Temperature > 30°C ? YES → Hot Weather Response,
  NO → Normal Response).
- **Agent Step:** delegates part of a workflow to an AI agent (summarize, classify, extract
  structured data, select the best source, decide which branch to use), with a clear contract:

  ```yaml
  input: rawArticle
  instruction: Extract people, companies and products
  output: Entity[]
  ```

- **Output:** the typed, structured result exposed by the tool, so it can connect safely to website
  blocks and other tools:

  ```yaml
  output:
    location: string
    temperature: number
    condition: string
    forecast: ForecastDay[]
  ```

## 9. AI-Assisted Tool Creation

Users can describe a tool in natural language ("Create a tool that accepts a city and returns the
current weather plus a three-day forecast."). The AI constructs the workflow (Natural Language →
Tool Architect → Inputs → Connector Selection → API Configuration → Transformation → Output Schema
→ Executable Tool). The user can then inspect and edit the generated graph, which becomes both the
authoring environment and the explainability layer for AI-generated logic.

## 10. Smart Connector Experience

Hide complexity by default. Instead of configuring HTTP request, headers, authentication, query
parameters, JSON path, transformation and error handling, the user says "Get current weather for
this location" and the agent configures the connector. A node has two modes: **Simple** (Weather
API, input: location, output: Weather) and **Advanced** (HTTP GET, URL, headers, auth, query
parameters, response mapping, timeout, retries).

## 11. n8n Compatibility

Interoperability with n8n without copying its user experience: import selected n8n workflows,
export compatible workflows where possible, map common nodes to swarm.press primitives (HTTP
Request, Webhook, Condition, Set / Transform, Code, AI model, database connectors), preserve
unsupported nodes as external/custom steps. swarm.press should remain semantically simpler than n8n
even if compatibility exists internally.

## 12. Connecting Website Blocks to Tools

This is where the two construction kits become one system. A Local Weather block on the Home page
uses the Get Weather tool with `visitor.city` as input and binds to its typed output:

```yaml
block: WeatherWidget
uses:
  tool: GetWeather
inputs:
  city: visitor.location.city
bindings:
  temperature: result.temperature
  condition: result.condition
  forecast: result.forecast
```

## 13. Shared Type System

The Website Kit and Tools Kit share a common schema system (Article, Author, Topic, Image, Weather,
Location, Product, Event, SearchResult). A block declares what it accepts; a tool declares what it
returns; if the schemas are compatible, the connection can be made visually (GetWeather → Output:
Weather → WeatherBlock, Input: Weather).

## 14. Agentic Layer

AI exists throughout the product rather than as a separate chatbot: **Site Architect** (creates and
modifies the blueprint), **Design Interpreter** (imported designs → semantic blocks and page types),
**Tool Architect** (workflows from descriptions), **Connector Agent** (selects and configures APIs),
**Schema Agent** (infers data structures and mappings), **Implementation Agent** (templates,
components, styling, runtime code), **Migration Agent** (imports sites, designs, workflows),
**Repair Agent** (diagnoses broken blocks, bindings, connectors, implementation).

## 15. Suggested Main Interface

Four views over one canvas with an Object / AI inspector and a properties panel: **Blueprint**
(page types, blocks, relationships, architecture), **Design** (visual direction, layouts, imported
Claude Design artifacts, tokens), **Tools** (workflows, APIs, agents, automations), **Preview** (the
live generated website).

## 16. Recommended UX Principle

> **Simple first, inspectable always.**

Nothing important should remain a black box: any AI-generated structure is inspectable as blocks,
schemas, relationships, workflow steps, bindings and rules.

## 17. Versioning and Regeneration

The semantic model must remain stable across regeneration: the architecture stays unchanged when
the generated code changes. swarm.press should version blueprint changes, design changes, tool graph
changes and generated implementations separately.

## 18. Conceptual Architecture

A **semantic model** (website blueprint: pages, blocks, collections, relationships, design intent;
tool graph: tools, inputs, connectors, operations, agents, outputs), joined by a **shared type
system**, under an **AI layer** (Site Architect, Design Interpreter, Tool Architect, Connector
Agent, Schema Agent, Implementation Agent), which produces a **generated runtime** (templates,
components, APIs, workflows, CSS, routing, agents, integrations).

## 19. Product Differentiation

1. Semantic website architecture: users define what the site is.
2. AI-generated implementation: templates and workflows are derived from the model.
3. Agentic tools as native website capabilities, connected directly to blocks.
4. External design environments remain usable as visual sources and editing surfaces without
   owning the site's structure.

## 20. Product Statement

> **swarm.press is a visual construction environment for agentic websites. Users architect page
> types, blocks, content relationships, design intent, and executable tools as semantic models; AI
> generates and maintains the underlying templates, components, workflows, integrations, and code.
> External design environments such as Claude Design can be imported or connected as visual sources
> while swarm.press remains the structural source of truth.**

## 21. Initial MVP Scope

- **Website Kit:** visual page-type canvas, reusable blocks, content collections, page
  relationships, basic design intent, AI-generated blueprint, AI template generation, live preview,
  HTML/ZIP importer, Claude Design export importer.
- **Tools Kit:** input/output nodes, HTTP connector, transform node, condition node, agent node,
  webhook trigger, tool execution/testing, structured schemas, natural-language tool generation.
- **Integration:** connect block to tool, visually map tool output to block input, typed schemas,
  preview tool-backed blocks.

## 22. Later Expansion

Live Claude Design connection, semantic design diffing, Figma importer, Git/repository importer,
website reverse engineering, n8n import/export, reusable tool and block marketplaces, team
collaboration, approval workflows, visual version history, multi-agent website maintenance,
autonomous content updates, production observability for tools and blocks, runtime permission
system.

## 23. Guiding Principle

```text
What the website IS  ≠  How the website is implemented
What a tool DOES     ≠  How its workflow is technically implemented
```

That separation is what allows swarm.press to remain visual, AI-native, flexible, regeneratable,
and understandable as the underlying technology evolves.
