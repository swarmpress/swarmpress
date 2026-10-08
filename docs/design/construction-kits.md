# Design: the site blueprint and the tool graphs, built in bricks

> **Status:** design, 2026-10-06. Nothing here is built. Decision:
> [ADR-0072](../adr/0072-site-blueprints-and-tool-graphs.md). Concept:
> [`docs/reference/construction-kits.md`](../reference/construction-kits.md) (the owner's "construction
> kits" concept). It builds on the brick construction kit
> ([`construction-kit.md`](construction-kit.md), ADR-0065), the extension SDK (ADR-0042, 0043, 0053),
> the content model (ADR-0014) and the site kit (ADR-0015). Features: FEAT-089 to FEAT-096. All
> increments come after the MVP. Formats and numbers here are *targets* until their increment lands.

The owner's concept describes two semantic models and a shared type system:
- a **website blueprint** (page types, blocks, collections, relationships, design intent);
- **tool graphs** (n8n-like workflows of inputs, connectors, operations, conditions, agent steps and
  outputs).

In both, AI generates the implementation. This document turns the concept into swarm.press terms. It
also says how both models are drawn and edited in the brick world: the site becomes a brick town,
and its tools become machines.

## 1. Owner decisions (2026-10-06)

| Question | Decision |
|---|---|
| Product or game? | **An in-game layer.** The CEO and the staff build the blueprint and the tools inside the dollhouse. swarm.press stays a management sim; this is not a pivot to a website builder |
| This step | Design, ADR and planned features only. No code |

## 2. Where swarm.press stands (survey, 2026-10-06)

| Concept piece | What exists | What is missing |
|---|---|---|
| Block catalogue | 46 core blocks and `x:` custom blocks (`packages/content-schema/src/blocks.ts`); `BlockMeta` holds intent, media and linking rules (`crates/content-model/src/blocks.rs`) | `BlockMeta` exists only in Rust |
| Page type | `page_type` is a free string. Only one type has rules (`content-model/src/article_profile.rs`), and `ARTICLE_TYPES` is duplicated in `site-kit/src/routes/plan.ts` | **a page-type registry; templates as data** |
| Routes, collections | `site.manifest.json` holds regions, sections and collections; routes come from a fixed set of `EntryKind`s | TypeScript expects the manifest at the repo root and Rust at `content/site.manifest.json`, with different field names |
| Relationships, navigation | implicit only: `Entity.related`, `collection-embed`, legacy `content/config/navigation.json` | not modelled |
| Design intent | W3C tokens in `theme/tokens.json` (`site-kit/src/tokens.ts`); Art Director and Web Developer prompts | no typed mood board; **no theme-generation job** |
| Tools | the SDK's `skill` kind: `ToolDef{description, input: JSONSchema, run}`, run in QuickJS with granted capabilities (`web` with an origin allowlist, `llm:<tier>`, `store:<table>`), installed through a CEO ticket (ADR-0053) | skills are written by hand in JS; the game does not load extensions yet |
| Agents calling tools | `crates/claude/src/tool_loop.rs` (`ToolExecutor`, `run_tool_loop`) | no caller. Agents produce schema-constrained JSON; the only live tool is server-side web search |
| Triggers | `poll.cadenceMinutes`, `onDayStart`, the GitHub deploy webhook | no generic schedule or webhook trigger |
| Bricks | `crates/kit`: catalogue, `swarmpress.design.v1`, the deterministic compiler and hash, typed ports (physical attachment only), surfaces bound to store data; generated room shells | no semantic or data-flow connections |

**Conclusion.** What swarm.press lacks is mostly a **data model**: the blueprint, the tool graph and the
type registry. It does not lack a renderer. The brick kit already has the hard part, a deterministic
compiler from JSON to bricks. Everything below follows from one rule:

> **The blueprint and the tool graphs are the source of truth. Brick models are compiled views of
> them.**

A model is generated into an ordinary `swarmpress.design.v1` design by a pure function, as room shells
are generated from sim rooms (`crates/kit/src/shell.rs`). Nobody edits the bricks of a model to change
what the site *is*. People edit the graph, in editors that look like bricks, and the model rebuilds.
This keeps the renderer free of decisions (CLAUDE.md rule 8), and it keeps the kit deterministic and
hashable.

## 3. The semantic model

### 3.1 Files in the site repo

The player owns the site repo (ADR-0047), so the models live there, next to the content they shape:

```
blueprint/
  site.json              swarmpress.blueprint.v1: page types, slots, globals, collections, relationships, navigation, intent
  types/<Name>.json      named types (a restricted JSON Schema subset, §3.2)
  tools/<id>.tool.json   swarmpress.tool.v1, one per tool
  layout.json            editor positions only; not semantic, not hashed (§5.1)
content/data/<tool>/…    outputs of build-time tools that blocks read (§7.3)
```

- `PathPolicy` (`crates/github/src/policy.rs`) gains a `structure_roots: ["blueprint"]` and a matching
  `ActorKind::StructureAgent`. Content agents still write only `content/` and design agents only
  `theme/`.
- The knowledge pack (`crates/knowledge/src/pack.rs`, ADR-0061) carries the blueprint, so every job
  sees the site's structure through the closed world.
- **Semantic hash:** `sha256("swarmpress:blueprint:v1" ‖ canonical JSON)`, computed the same way as
  the design hash (`Design::canonical` in `crates/kit/src/design.rs`). The same scheme applies to tools,
  with the domain `swarmpress:tool:v1`.

### 3.2 Types: one system for both kits

- A type is a named schema in a **restricted JSON Schema subset**: `object` (closed), `array`,
  `string`, `integer`, `number`, `boolean`, `enum`, `$ref` to another named type, and `LocalizedString`.
  There are no `oneOf`, patterns or conditionals.
- The subset is deliberate:
  - compatibility checking stays simple and decidable;
  - generated docs stay short for prompts;
  - a model can produce it reliably.
- **Built-in types** come from what swarm.press already knows:
  - `Page` and `Article` (a page of type `blog-article`) from the content model;
  - `Media` from the media index;
  - one type per `EntityKind` (`Village`, `Trail`…);
  - one type per collection, from its schema path in the manifest.

  Sites add their own types (`Weather`, `FerryDeparture`) in `blueprint/types/`.
- Type references read `Article`, `Article[]` or `Weather?`.
- **Compatibility is structural:**
  - a producer fits a consumer when every *required* consumer field exists in the producer with a
    compatible type;
  - arrays fit arrays of compatible items;
  - `T` fits `T?`;
  - optional fields are ignored when missing.

  One checker, `blueprint::types::fits(producer, consumer) -> Result<(), Vec<TypeIssue>>`, serves the
  blueprint, the tools and the bindings between them.
- Block slots and tool ports both declare types, so "can this tube go into that storey?" is the same
  question everywhere.

### 3.3 The blueprint (`swarmpress.blueprint.v1`)

```json
{
  "format": "swarmpress.blueprint.v1",
  "globals": {
    "header": { "block": "x:site-header", "intent": "navigate" },
    "footer": { "block": "x:site-footer", "intent": "navigate" }
  },
  "page_types": [
    {
      "id": "blog-article",
      "label": { "en": "Article" },
      "route": "/{lang}/blog/{slug}",
      "source": { "kind": "page" },
      "slots": [
        { "id": "hero",    "block": "editorial-hero", "required": true },
        { "id": "body",    "blocks": ["heading", "paragraph", "list", "callout", "image"], "repeat": true },
        { "id": "ferries", "block": "x:ferry-times", "required": false,
          "source": { "tool": "ligurian-ferries", "inputs": { "village": "page.entity" }, "accepts": "FerryDeparture[]" } },
        { "id": "closing", "block": "closing-note", "required": true }
      ],
      "linking": { "min_links": 3, "targets": ["village", "blog-article"] },
      "uses": ["header", "footer"]
    },
    { "id": "village", "label": { "en": "Village" }, "route": "/{lang}/{region}", "source": { "kind": "collection-item", "collection": "villages" }, "slots": [] }
  ],
  "collections": [
    { "id": "latest-articles", "type": "Article", "from": "page_type:blog-article", "order": "published_at desc", "limit": 6 }
  ],
  "relationships": [
    { "from": "blog-article", "to": "village", "kind": "about", "cardinality": "many-to-many", "via": "metadata.entities" }
  ],
  "navigation": [ { "page_type": "home" }, { "section": "villages" }, { "page_type": "blog-index" } ],
  "intent": { "keywords": ["editorial", "image-heavy"], "tokens": "theme/tokens.json" }
}
```

- **Page types replace the hard-coded article profile.** `check_article_profile()` becomes a check of a
  page against its page type's slots: required blocks, allowed blocks, order and repeats. Then
  `page_type` stops being a free string and becomes a closed-world id. Unknown ids are validation
  errors, as for links and media (rule 5). This is FEAT-089, the first increment, and it is useful even
  if nothing else here is ever built.
- **Slots name catalogue blocks.** A slot names blocks by `CORE_BLOCK_TYPES` id or `x:` id. Its intent,
  media rules and linking rules come from `BlockMeta`, which moves to data that both Rust and
  TypeScript read.
- **No duplication with the manifest.** The blueprint *references* the manifest's region, section and
  collection ids. At the site-kit cutover (`docs/runbooks/cinqueterre-cutover.md`, steps 3 to 5), the
  manifest's structural parts are *derived from* the blueprint, so there is one source per fact
  (rule 6). Until then the manifest is authoritative for routes, and the blueprint is checked against
  it.
- **Design intent:** a closed keyword enum, plus a pointer to the theme's tokens. The Art Director's
  mood board becomes a typed artifact that fills these fields.

### 3.4 Tool graphs (`swarmpress.tool.v1`)

```json
{
  "format": "swarmpress.tool.v1",
  "id": "ligurian-ferries",
  "name": { "en": "Ferry departures" },
  "inputs":  { "village": "Village" },
  "outputs": { "departures": "FerryDeparture[]" },
  "nodes": [
    { "id": "in",    "kind": "input" },
    { "id": "fetch", "kind": "connector", "connector": "http-get", "url": "https://www.navigazionegolfodeipoeti.it/orari.json", "returns": "FerryTimetableRaw" },
    { "id": "pick",  "kind": "op", "op": "filter", "where": { "path": "stop", "eq": "$in.village.slug" } },
    { "id": "shape", "kind": "op", "op": "map", "to": "FerryDeparture", "fields": { "time": "$.dep", "to": "$.dest" } },
    { "id": "out",   "kind": "output", "port": "departures" }
  ],
  "edges": [ ["in.village", "pick.param"], ["fetch.out", "pick.in"], ["pick.out", "shape.in"], ["shape.out", "out.in"] ],
  "triggers": [ { "kind": "schedule", "every_game_days": 1 } ],
  "failure": { "retries": 1, "on_error": "keep-last" },
  "limits": { "llm_calls_per_run": 0, "fetches_per_run": 1 }
}
```

**The node catalogue is closed and small.** This is the "semantically simpler than n8n" of the concept:

| Kind | v1 members | Notes |
|---|---|---|
| `input`, `output` | one per declared port | typed |
| `connector` | `http-get`, `rss`, `web-search` (server-side, ADR-0068), `knowledge` (pack query), `store-read`, `tool` (another tool) | URLs are literal origins, so the capability allowlist can be derived from them; no templated hosts |
| `op` | `pick`, `map`, `filter`, `sort`, `limit`, `merge`, `split`, `format` (template, no code), `validate` | pure; paths use a tiny `$.a.b[0]` language, never `eval` |
| `condition` | `compare`, `exists`, `switch` (enum) | two or more outlets |
| `agent` | `{role, tier, instruction, output: Type}` | a structured call checked against the output type, with one repair turn (the board's `schedule#0` pattern) |
| `skill` | a tool of an installed SDK skill | the escape hatch for code: code lives in a reviewed extension, never in a node |

- There is no free-code node. A step that needs code is a `skill` node, which keeps code reviewable and
  sandboxed under its own manifest.
- **Credentials** are referenced by name (`credential: "ferry-api"`) and resolved by the credential
  proxy (ADR-0054). Their values never appear in a graph.

### 3.5 Binding a block to a tool

A slot's `source.tool` binds the slot to a tool. Its `inputs` are paths into a **closed context**:
`page.*`, `item.*` and `site.*`, plus `visitor.*` later. Its `accepts` type must fit the tool's output.

Where the tool runs matters more than the notation:

| Binding time | When it runs | Data path | v1? |
|---|---|---|---|
| **Build time** | when staff draft or refresh a page | the orchestrator runs the tool and commits the output to `content/data/<tool>/<key>.json`; the block reads that file | **yes** |
| **Scheduled** | on the tool's trigger (`every_game_days`, real-time cadence for live data) | the same as build time, as a refresh work item | **yes** |
| **Request time** | per visitor (weather at `visitor.city`) | the static Astro site needs a hosted endpoint: a central function or an edge function, with credits | **no**: needs its own ADR under the commercial model (ADR-0049 compute plane) |

The concept's weather-per-visitor example is therefore the *last* case, not the first. The first real
case is cinqueterre.travel's ferry, train and trail-status data, refreshed on a schedule and committed
as data. This fits every rule: the content stays in the repo, and runs reach the sim only as digests.

## 4. Bricks: the site is a town, its tools are machines

### 4.1 One generator, two scales

`crates/blueprint/src/bricks.rs` compiles a blueprint and its tools into one `swarmpress.design.v1`
design, the **town**. The function is pure and deterministic, and its golden tests pin it. The kit
compiles the town like any other design.

- The town's `Provenance` gains a variant `View { source: "blueprint", hash }`. This is a small change to
  the kit's format (ADR-0065), and it marks the design as generated, not editable.
- The renderer draws the town in two places:
  1. **In the office, as a miniature** on the model table: a planning-table design in the
     `StrategyRoom` or `DesignStudio`, scaled by 1/8. The scale is a view parameter, the way a surface's
     size is.
  2. **In the Blueprint view**: the town at full brick scale in its own scene, with the camera of the
     office. Here people inspect, edit and watch it.
- Detail follows the levels of the information surfaces (ADR-0063):
  - far: buildings only;
  - mid: storeys and tubes;
  - close: labels drawn on door-sign and storey surfaces from store data.

### 4.2 Mapping: the website blueprint

| Semantic | Brick form | Rule of the generator |
|---|---|---|
| Site | the town baseplate | size grows in 32-stud blocks to fit the buildings |
| Page type | a **modular building** | footprint 8×8 studs; buildings in navigation order along the main street, others behind; the door sign is a surface showing the route |
| Slot (block) | one **storey**, stacked bottom-up in page order | 1 brick high; colour = `BlockMeta.intent` (Showcase, Inform, Navigate, Convert, Compare, Orient, Engage → fixed palette colours); optional slot = the transparent variant; repeated slot = a storey with a 1×1 pillar pattern |
| Global block | a shared **roof** (header) and **foundation** (footer) | identical design on every building that `uses` it |
| Collection | a **warehouse** of identical tiles | the tile stack's height is the item count from the knowledge pack (log scale, capped) |
| Relationship | a **skywalk** between two buildings | one skywalk per relationship, at the height of the slot that renders it; many-to-many is drawn double-width |
| Design intent | the town's colour scheme | each token colour maps to the nearest palette colour (CIEDE2000 over `kit/palette.json`) |
| Health | a red emissive 1×1 tile on a storey's corner | from validation issues and the site audit (orphans, policy findings, ADR-0070) |
| A page | not drawn | the town shows the *types*; the page count is a number on the door sign |

### 4.3 Mapping: tools (the factory district)

| Semantic | Brick form |
|---|---|
| Tool | a **machine** on its own plot in the factory district beside the town |
| Input | a **hopper** on the machine's left |
| Connector | a **dish or antenna**: `http-get` is a dish, `rss` a mast, `web-search` a telescope, `knowledge` a bookshelf, `tool` a smaller machine |
| Op | a **gearbox**; a printed tile names the op |
| Condition | a **track switch** with one outlet per branch |
| Agent step | a **workstation with a minifig**: the staff member whose role and tier the step uses |
| Skill node | a **sealed crate** printed with the extension's id |
| Output | a **chute** that drops typed tiles |
| Edge | a **flex tube** coloured by type |

- **Layout** is a deterministic layered drawing:
  - the layer of a node is its longest path from an input;
  - within a layer, nodes are ordered by id;
  - tubes are routed on the stud grid, with bends at fixed offsets.

  Layout does not depend on the editor's positions (§5.1).
- **Types are coupling shapes.** This is the Lego picture of a type system: a stud fits only an anti-stud.
  - Scalars use a 1×1 coupling, objects 2×2, lists a 2×2 ribbed coupling.
  - Built-in types have fixed colours (`string` white, `Article` blue, `Media` green…). A site's own
    types take colours from the remaining palette, by a stable hash of the type name.
  - A joint the checker rejects is drawn as a **red seam**. It is also an issue (`type-mismatch`) of the
    graph checker, not of the brick compiler.
- **Where the kits meet:** a tube leaves a machine's chute and enters the storey of the slot it feeds.
  The binding is visible as a pipe, and the type check is visible as the coupling.

### 4.4 Motion comes from facts

- A **tool run** shows tiles travelling through the tubes. The motion replays the run's trace from the
  store, the way a monitor's close content does. It is not sim state.
- When a run contains an agent step, the sim knows about the run (§6). So the staff member really walks
  to the workshop station, and the time is really spent: agents in a tool are the company's people, not
  anonymous models.
- A **blueprint change** that the CEO approves rebuilds the town in build order. The kit already orders
  bricks by build order for construction animations.

## 5. Editing: simple first, inspectable always

### 5.1 The brick canvas

The authoring surface is a **flat, top-down brick canvas** in the overlay, built with Preact and SVG
like the Plan panel. It is not 3D. Direct 3D manipulation is hard to make precise, and it would
duplicate player building (FEAT-026). The canvas has two tabs, **Blueprint** and **Tools**.

- **The parts bin** on the left is the closed catalogue:
  - blocks from the block catalogue, coloured by intent;
  - page-type and collection templates;
  - the tool node kinds.

  Nothing can be placed that the checker would not know.
- **Snap and connect:** nodes are brick tiles with studs, and they snap to a stud grid.
  - Dragging from an outlet stud shows the compatible inlets lit and the rest dimmed. The type checker
    runs in wasm on every move.
  - Storeys stack inside a building by dragging.
- **The inspector** has two modes, as the concept asks:
  - **simple**: purpose, source and the key parameters in words;
  - **advanced**: the node's JSON, its types and its issues, by id.
- **Positions** go to `blueprint/layout.json`, which is excluded from the semantic hash. Moving a brick
  on the canvas is therefore not a change to the site.
- **Preview:** a page type's preview renders an existing page of that type through the site kit's
  screenshot path. A new type is previewed from a generated example page. This is not a live site.

### 5.2 Who changes what

| Actor | How | Lands |
|---|---|---|
| The CEO (player) | edits on the canvas | directly, as a commit through the gateway (the CEO owns the site); it opens the implementation work it implies (§6) |
| Staff (the architects, §9) | a job returns a **proposed diff** as an artifact | as a `StructureApproval` ticket. Its default never applies the diff, like the publish gate (ADR-0059) |
| Extensions | a skill may propose a diff | always as a ticket |

**Diffs are semantic and keyed by stable ids**, as in the concept's §5.4. The canvas and the town both
show them:
- additions outlined green;
- removals ghosted;
- changed nodes yellow, with a field list in the inspector.

### 5.3 "Ask the architect"

The canvas has a text box addressed to a staff member, not to a chatbot. "Add an author page type and
link articles to it" becomes a request to the Information Architect. The answer comes back as a diff
on the canvas.

## 6. The sim boundary

Text never enters the sim (rule 2), and the orchestrator owns transitions (rule 3). The sim sees:

| Command or effect | Fields |
|---|---|
| `BlueprintChanged` | `{hash, page_types, slots, issues}`, counts only |
| `ToolInstalled` / `ToolRemoved` | `{tool, hash}` |
| `ToolRunCompleted` | `{tool, ok, ms, artifact_sha}` |
| `ToolRunFailed` | `{tool, reason}`, the reason a closed enum |
| `WorkItemKind::Structure` | apply an approved blueprint diff; it spawns the implementation items |
| `WorkItemKind::Tool` | build or change a tool |
| `JobKind::Architect` | propose a blueprint diff |
| `JobKind::ToolBuild` | propose a tool graph |
| `JobKind::ToolRun` | a run with an agent step (staff time) |
| `JobKind::ThemeCode` | implement the blueprint's templates in `theme/**` |
| `QuestionKind::StructureApproval` | approve a staff-proposed diff; the default never applies it |

- `render_state()` gains two facts, both from the sim:
  - the model table, as equipment;
  - the installed tools as `{id, hash}`.

  Geometry and labels come from the store, as surface content does (rule 8). This is a render-state
  contract change (`docs/architecture/render-state.md`).
- A pure tool run with no agent step has no staff cost. It runs as a host side effect and reports
  `ToolRunCompleted`.

## 7. Running tools

### 7.1 A tool graph compiles into a skill

A tool graph is installed as an SDK `skill` extension (ADR-0042, 0043), with no new runtime:

- **The manifest is derived from the graph.** `kinds: ["skill"]`, and the capabilities come from the
  connectors:
  - `http-get`/`rss` → `web` plus `origins` from the literal URLs;
  - `agent` → `llm:<tier>`;
  - `store-read` → `store:<table>`.

  The `limits` come from the graph's `limits`.
- **The bundle is one shared interpreter**, `packages/toolgraph` (graph JSON in, typed result out). The
  graph is pack data (`entry.content`). The interpreter is reviewed once, and graphs are data.
- **Install** goes through the ADR-0053 install ticket, with the derived cost ceiling. User-built tools
  get the sandbox, capability gates, limits and provenance (FEAT-058) for free.
- **Where it runs:** wherever skills run, in the lease-holding browser or a runner. The game must first
  load extensions, which it does not do yet (FEAT-054/056 run only on Bun today).

### 7.2 Trace and replay

- The interpreter records a **trace**: each node's input hash, output hash, time and issue. It goes to
  the store, never to the sim.
- Connector and agent outputs are recorded too. A rerun keyed by `(tool, run, node)` reuses them, as
  staged jobs reuse stage results (`crates/orchestrator/src/staged.rs`, ADR-0058).
- So the "test" button replays a run without fetching again.

### 7.3 Build-time data

- A build-time or scheduled run writes its output as `content/data/<tool>/<key>.json` through the
  gateway, as a content-agent write.
- It is validated against the output type. The block that reads it gets the type's schema in its
  renderer's docs.
- The page JSON keeps referring to blocks only. It never inlines tool output.

### 7.4 Agents calling tools

A role can be granted tools in `config/roles.toml` (`tools = ["ligurian-ferries"]`). In a job, the model
then sees them as function tools:

- **Local or fake path:** `crates/claude/src/tool_loop.rs` runs them through a `ToolExecutor` that
  calls the sandbox.
- **Hosted GPT-6-Luna path** (ADR-0067; the server holds the key): the server returns the model's
  function call to the browser, the browser runs the tool in the sandbox, and it posts the result back.
  This round trip is new and needs its own design before T-1.

**As built (2026-10-07):**
- No vendor function calling is used on either path. `agents::tool_use` offers tools inside the
  structured answer itself: an optional `use_tools` list whose tool ids are a closed enum.
- The browser host runs the requested tools in the sandbox and sends the results back as the next
  message. The hosted model therefore needs no new server round trip: each round is an ordinary
  structured call through the central server.
- The first user is the Draft's `tools#0` research stage. Its facts join the dossier with the
  source `tool:<id>`, and only when the tool actually ran.

## 8. Creating a blueprint: the concept's three modes

| Mode | In swarm.press | Model? |
|---|---|---|
| **Import the existing site** (first) | **reverse-engineer cinqueterre.travel** into a read-only blueprint: page types from the page registry, slots from block usage per `page_type` (a block in the same position on 80% or more of a type's pages becomes a slot), relationships from `Entity.related` and `collection-embed`, navigation from `navigation.json`, intent from `tokens.json` | **no**: deterministic, golden-tested. It is honest about the frozen theme: it reads and never writes (rule 9) |
| **Describe** | the Information Architect's `Architect` job: structured output in the blueprint schema, the checker, one repair turn, the result as a diff | yes |
| **Import a design (HTML or ZIP)** | a Design Interpreter stage. A deterministic DOM pass builds a section tree: landmarks, headings, repeated sibling structures as collections, CSS custom properties as token candidates. The model only labels sections with catalogue block ids and names collections. Imported files are untrusted: they are parsed as data, scripts never run, and they are size-capped | yes, labelling only |
| **Blank** | the canvas, starting from the globals | no |

- **Claude Design** enters through file export (the concept's mode A), which is the HTML/ZIP row.
- A live connection (mode B) waits for a public API; nothing here depends on one.
- The roundtrip (mode C) is the same import run again. It produces a **semantic diff** against the
  blueprint, instead of replacing it.
- **n8n** (FEAT-096). Superseded by ADR-0076 (2026-10-08): workflows now import node for node as
  `n8n` nodes and run with n8n's semantics (expressions and Code in a sandbox with no capabilities;
  26 node types; see §12 and the feature). The first version was a deterministic mapping from
  n8n JSON:

  | n8n node | swarm.press node |
  |---|---|
  | HTTP Request | `connector http-get` |
  | IF | `condition` |
  | Set | `op map` |
  | Merge | `op merge` |
  | Schedule | trigger |
  | anything else, including Code | a **sealed crate** that blocks the tool and opens a ticket (rule 11: stubs fail loudly) |

  Export to n8n is not planned.

## 9. The concept's agents are staff

| Concept agent | swarm.press |
|---|---|
| Site Architect | the **Information Architect**, played by the **UX designer** (else the strategist, else the editor-in-chief: the sim's `WorkItemKind::architects`). No new role was added (FEAT-095): the `site-architect` job runs on the UX designer's persona with its own prompt (`crates/agents/prompts/information_architect.md`) |
| Design Interpreter | the Art Director, with a new interpretation stage |
| Tool Architect, Connector Agent, Schema Agent | the **Web Developer**. Connector choice and schema inference are stages of the `ToolBuild` job, not separate people |
| Implementation Agent | the Web Developer (`theme-code`) with the Art Director's mood board (FEAT-045 gate) |
| Migration Agent | the deterministic importers (§8) |
| Repair Agent | the existing maintain flow (`crates/orchestrator/src/maintain.rs`) and the site audit (ADR-0070), extended to blueprint and tool issues |

**Why it is fun.** Structure becomes a lever the CEO can pull and watch pay off.
- A new page type or a ferry tool costs staff time and money.
- The analytics loop (ADR-0071) shows whether it paid: page views and engaged time per page type.
- The town shows the payoff physically: busy buildings and red tiles.
- Later, challenges can set structural goals ("reach X with at most five page types"). A blueprint and
  its tools are shareable as a pack (the `.room` idea of ADR-0065, at site scale).

## 10. Increments (all after the MVP)

| # | Increment | Feature | Depends on |
|---|---|---|---|
| B-0 | Page-type registry as data; `article_profile` and `ARTICLE_TYPES` derived from it; `page_type` becomes a closed-world id; `BlockMeta` moves to shared data | FEAT-089 | — |
| B-1 | `crates/blueprint`: the format, the types and the checker; reverse-engineering cinqueterre.travel into a read-only blueprint; the town generator with golden tests; the model table behind `?office=bricks` | FEAT-090, FEAT-093 | B-0, K-3 (FEAT-081) |
| B-2 | The brick canvas (Blueprint tab), CEO edits, semantic diff, `StructureApproval`, the Information Architect's `Architect` job | FEAT-090, FEAT-095 | B-1, FEAT-079 |
| T-0 | `swarmpress.tool.v1`, the checker, the `packages/toolgraph` interpreter as a skill, trace and replay; tests on Bun | FEAT-091 | FEAT-056 |
| T-1 | The game loads extensions; the Tools tab; the factory district; the Web Developer's `ToolBuild` job; scheduled runs | FEAT-091, FEAT-095 | T-0 |
| X-1 | Build-time bindings (`content/data/`), the first real tool (ferry times), the tube from machine to storey | FEAT-092 | B-2, T-1 |
| X-2 | `theme-code` from the blueprint (implementation regenerates; the blueprint stays) | FEAT-094 | X-1, FEAT-045, the site-kit cutover |
| X-3 | HTML/ZIP and Claude Design export import; n8n import; agents calling tools (§7.4) | FEAT-093, FEAT-096 | B-2, T-1 |

## 11. Risks and open points

1. **Two sources of truth before the cutover.** The manifest and the blueprint overlap until the
   manifest is derived (§3.3). Mitigation: the blueprint references and never restates; a check fails on
   any disagreement.
2. **Request-time tools need compute.** A static site cannot run them. They need an ADR on hosted
   functions, credits and abuse limits. Until then the concept's visitor-weather example is out of scope.
3. **Function calls on the hosted model** cross server and browser (§7.4). Resolved without vendor
   function calling: tool requests are part of the structured answer, and the browser runs them
   between ordinary calls.
4. **Scope creep toward n8n.** (Since ADR-0076 the owner wants n8n compatibility: the guard is now the closed list of n8n types that run, and the capability-less code sandbox.) The closed node catalogue is the guard. A new node kind needs a reason,
   and code goes into skills.
5. **Town legibility and cost.** A site with 15 page types of 12 storeys each, plus 10 machines, is
   roughly 4,000 bricks: within the office's budget (`docs/qualification/brick-office-spike.md`), but
   labels carry the meaning. The close level is essential, not decoration.
6. **Small or hosted models writing graphs.** The answers are the closed catalogues, generated docs, the
   checker's issue ids and repair turns, as in the office designer (FEAT-084). Graphs stay small (at most
   12 nodes in v1).
7. **Security.**
   - Connectors go through the sandbox's origin allowlist and, for server fetches, the SSRF-guarded web
     proxy (`crates/server/src/web.rs`).
   - Imported HTML and ZIP files are untrusted data.
   - Credentials stay in the proxy (ADR-0054).
8. **The frozen theme.** Nothing here writes to `packages/site-builder/src/themes/cinque-terre/**`.
   X-2 waits for the cutover.

## 12. As built (2026-10-07)

Every increment of §10 is implemented. Each feature file has an "As built" section with the details.

| # | What landed | Main code |
|---|---|---|
| B-0 | The page-type registry and `BlockMeta` as data; `page_type` is a closed-world id | `crates/content-model`, `packages/content-schema` |
| B-1 | `swarmpress.blueprint.v1`, the type subset, the checker and the semantic hash; the live site's blueprint reverse-engineered without a model; the town compiled to `swarmpress.design.v1`; the model table | `crates/blueprint`, `crates/blueprint-wasm` |
| B-2 | The Blueprint tab (brick canvas, inspector, live check and diff); `PUT /api/site/blueprint` as the structure actor; `Commission` and the `StructureApproval` ticket; the Information Architect's `Architect` job (closed edits, one repair turn) | `apps/game/src/ui/components/Blueprint*.tsx`, `crates/server/src/site_blueprint.rs`, `crates/orchestrator/src/structure.rs` |
| T-0 | `swarmpress.tool.v1`, its checker and derived manifest; the interpreter as a sandboxed skill with trace and replay | `crates/blueprint/src/tools.rs`, `packages/toolgraph` |
| T-1 | The Tools tab and the factory district; the Web Developer's `ToolBuild` job; `ToolRun` jobs on demand, by schedule and through "Run now", run in the browser sandbox | `apps/game/src/tools`, `apps/game/src/render/bricks/machines.ts` |
| X-1 | Tool output as typed site data (`PUT /api/site/data`), bindings run per page, `ctx.toolData` at build time | `crates/server/src/site_data.rs`, `packages/site-kit` |
| X-2 | The `ThemeCode` job writes the missing block renderers on `design/<item>`, and Publish merges them; a site on the frozen theme fails loudly | `crates/orchestrator/src/structure.rs`, `crates/server/src/site_theme.rs` |
| X-3 | HTML/ZIP (Claude Design) import into the draft; n8n import with sealed steps; agents calling tools (`tools#0`) | `apps/game/src/blueprint/design-import.ts`, `packages/toolgraph` (n8n), `crates/orchestrator/src/tool_facts.rs` |

The plan's deviations:
- The Information Architect is played by the UX designer role (FEAT-095); no new role was added.
- Agents call tools inside structured answers, without vendor function calling (§7.4).
- X-2 cannot reach cinqueterre.travel before the cutover (rule 9). On that site the job fails
  loudly, by design.

### n8n compatibility (2026-10-08, ADR-0076)

The owner asked that tools be compatible with n8n, so existing flows can be reused (import only).
- **Node for node.** An imported workflow keeps every node as an `n8n` node: name, type, version and
  parameters unchanged.
- **n8n's semantics.** Nodes run on item lists: an IF splits items between its outputs, and an empty
  output does not run what follows.
- **JavaScript in a sandbox.** Expressions, Code, Function, Date & Time and sort comparators run in a
  nested QuickJS sandbox with no capabilities (the `code` capability), with n8n's globals and helpers.
- **Requests.** They go through `POST /web/request` with any method. A credential is signed by the
  browser, outside the sandbox.
- **Twenty-six node types run.** The rest stay in the graph as sealed steps the checker refuses.
- **In bricks.** An n8n node stands as the machine of what it does:
  - a request is a dish;
  - IF, Filter and Switch are a switch;
  - a model call is a workstation;
  - Code is a sage bench with a screen;
  - other item steps are a gearbox;
  - a type that does not run is a crate.
- **In the game.** The Tools tab imports a workflow (preview, manifest, issues, Install) and manages
  the credentials.
