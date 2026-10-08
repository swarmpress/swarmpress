# The Brick Studio: the builder as a game

**Status:** decided ([ADR-0077](../adr/0077-the-brick-studio.md)). Built: the Studio, the Building workbench, the instruction booklet (FEAT-100, FEAT-101), and the Factory workbench's core (FEAT-103). The rest is planned.
**Date:** 2026-10-08
**Extends:** ADR-0072 §5 and §7, and [construction-kits.md](construction-kits.md) §5.

## 1. Why and what

### The owner's brief (2026-10-08)

The interface for the site builder, the tools, the page builder and the theme must be **game-like, very intuitive and very powerful**. It builds on the game's own brick idea: blocks, combining blocks, and workflows made of blocks. The references are **Cities: Skylines** (a living map, info views, zoning, supply chains) and **the LEGO Builder app** (step-by-step instructions, new parts highlighted, a parts callout per step).

### Two owner decisions frame the design

- **No 3D for building.** The editors are flat brick workbenches: precise, readable and easy. The 3D brick town (ADR-0072 §6) stays the place you *watch* the site; you build on the flat benches. Building in 3D would be too tricky for users, especially in the page builder and the tools.
- **Zone and build, both.** The CEO can build directly, brick by brick. The CEO can also ask staff to build: the request becomes a construction site, and the result comes back as an instruction booklet to step through and approve.

### What stays as decided

- The closed world: only catalogue parts exist.
- The shared checker in Rust: one checker, the browser's and the server's.
- The authority rules:
  - CEO edits land directly;
  - staff proposals pass the CEO's `StructureApproval`.
- Text is data: anything a model or a site wrote is rendered as text, never as markup.

## 2. One grammar: pick, snap, click

Every workbench uses the same five verbs, so learning one teaches all of them.

| Verb | Mouse / touch | Keyboard | What happens |
|---|---|---|---|
| **Pick** | click a part in the tray, or press and drag it | Tab to the part, then Enter | the part is in your hand; the tray part lifts |
| **See** | — | — | every place it could go lights up: **green studs** where the checker accepts it, a **red seam** with the checker's reason where it does not |
| **Snap** | click a lit place, or release the drag over it | Tab to the place, then Enter | the part clicks in: a short settle animation, an optional click sound |
| **Bulldoze** | the × on a selected brick | Delete on a focused brick | the part goes; a storey with no blocks left goes with it |
| **Undo** | Undo / Redo buttons | Ctrl/⌘ Z, Ctrl/⌘ Shift Z | up to 100 steps, across all workbenches |

Further rules:
- **Escape** puts a part back. **`/`** finds a part by name or description.
- **Validity comes from one place.** The site's own checker (`crates/blueprint`, compiled to wasm) judges every candidate drop. A drop is allowed when it adds no issue the draft did not already have. Nothing the server would refuse can be built.
- **Feel.**
  - Bricks have studs, a bevel and flat palette colours (`kit/palette.json`, shared with the 3D town).
  - A storey settles when a part lands.
  - The click sound is off by default, a per-viewer setting.
  - Motion is off under `prefers-reduced-motion`.
- **Two inspector modes:** Simple in words and steppers, Advanced in JSON, types and issues ("simple first, inspectable always").
- **Read only:** a session without the lease, or an imported blueprint not yet adopted, sees everything and can pick nothing.

## 3. The Studio: four workbenches over the whole screen

Key B, or the toolbar's Blueprint button, opens the Studio over the whole screen. Its workbench bar has Town, Building, Factory and (later) Paint shop. Undo, Redo and the sound setting sit above. The review bar sits below: Issues, Changes, Note, then **Review your build** and Discard.

### 3.1 Town (the site): the city map

- **What it shows:**
  - each page type is a **building** on the main street, in navigation order;
  - its **storeys** are its slots, coloured by the intent of their first block;
  - the **roof and foundation** are the globals it uses (header, footer);
  - **walkways** are relationships, **warehouses** are collections (stack height = item count);
  - **tubes** lead from the factory district into the storeys that tools fill.
- **Today (built, FEAT-090):** the flat brick canvas, the parts bin, the inspector, design import and Ask the architect.
- **Info views (planned, FEAT-102)** are toggles over the map, like Cities' data views. Each colours the buildings by one fact:
  - **Issues:** red storeys, from the checker;
  - **Data supply:** storeys fed by tools, and buildings that expect data but have none;
  - **Freshness:** stale pages, from the site audit (ADR-0070);
  - **Traffic:** pageviews per page type, from the analytics loop (ADR-0071);
  - **Languages:** translation coverage (ADR-0073);
  - **Link health:** broken links (ADR-0070).
- **Zoning (planned, FEAT-102):**
  - The **construction-site tool** places a plot on the map with a request ("an author page for every writer") and the builder: the Information Architect for structure, the Web Developer for tools. That is the existing `Commission`.
  - While the job runs, the plot shows **scaffolding** and the staff member's figure.
  - When the proposal lands, a **"booklet ready"** sign stands on the plot. Clicking it opens the booklet.

### 3.2 Building (the page builder): one page type from the front

- **Built (FEAT-100).**
- **Layout:**
  - the **street** on the left (buildings as mini stacks);
  - the **elevation** in the middle;
  - the **inspector** on the right;
  - the **tray** along the bottom.
- **The elevation:**
  - **storeys** stacked in page order;
  - each storey's **blocks as bricks** in their intent colours;
  - **glass** (dashed) storeys are optional, and **pillars** mark a repeating storey;
  - the min–max range is printed on the storey.
- **Building:**
  - a part dropped on a storey joins its blocks;
  - dropped in a **gap** between storeys, it becomes a new, optional storey there, named after the block;
  - the roof and foundation chips switch the globals;
  - the inspector edits a storey's min, max and place, and removes it.
- **Platform buildings** (`blog-article`, `blog-index`) carry a 🔒. Their storeys are the platform's, so the tray is disabled for them and the hint explains why.
- **Planned:**
  - **binding a tool:** drag a tube from the factory dock onto a storey; a small dialog maps the tool's inputs to `page.*`, `item.*` and `site.*`;
  - **a live preview** of a sample page of the type beside the elevation;
  - **editing a single page's blocks:** out of scope for now. Updates are for articles only (ADR-0070 §6); this would need its own ADR.

### 3.3 Factory (the tools): supply chains

- **Built (FEAT-103):** the Workbench (the machines overview, n8n import, credentials and Run now stay beside it). The tray places machines with complete defaults; tubes run from an outlet to an inlet the checker lights green; the inspector edits a machine in words or JSON, and the tool's name, trigger and types; undo and redo; Save tools.
- **Planned:** the rest of this list: typed couplings, recipes, test-run replay, n8n as a booklet.
  - **Machines** are the closed node catalogue:
    - input (hopper);
    - connector (dish, mast, telescope, bookshelf);
    - op (gearbox);
    - condition (track switch);
    - agent (a workstation with the staff member);
    - skill (sealed crate);
    - output (chute).
  - **Couplings show the type:** a round 1×1 is a scalar, a square 2×2 an object, a ribbed 2×2 a list. Drag from an outlet: compatible inlets glow and the rest dim, with the type check (`check_tool`) running on every move. A rejected joint is a red seam with the reason.
  - **Recipes:** prefab tools in the tray (an RSS digest, a ferry timetable, the weather) to drop and adjust.
  - **Test run:** the interpreter's trace replays as tiles moving through the tubes, with the values on hover.
  - **n8n import** (ADR-0076): "unpack a set", which opens the import as a booklet.
- This is sequenced after the n8n work in `ui/blueprint/Tools.tsx` and `apps/game/src/tools/**` lands.

### 3.4 Paint shop (the theme)

- **Planned (FEAT-104).**
- **What it holds:**
  - **style sets:** the design intent keywords (editorial, minimal, cinematic…);
  - **palette swatches** and **type tiles** from the theme tokens.
- **The preview** repaints the town and the page preview.
- **Changes** go out as a theme change through the ThemeCode work item and its approval. The CEO never writes theme code.

## 4. The instruction booklet: how every change set is reviewed

Every change set is reviewed the same way:
- a staff proposal (`StructureApproval`);
- the CEO's own draft ("Review your build");
- later, an n8n import.

**Layout**
- **Steps:** one step per semantic change (`blueprint::Change`), numbered "3 of 7".
- **Bags:** one per building, in street order, with the site-wide changes (globals, collections, navigation, intent) last. The bag list jumps straight to a bag.
- **The step's model:**
  - the building it works on, in front elevation, with the storeys the step touches outlined and the rest dimmed;
  - a site-wide step shows the town map with the change marked.
- **A callout per step:** the parts added and taken away ("+ storey profile", "+ hero", "− callout").
- **Navigation:** Back / Next, a scrub slider, and ← / → on the keyboard. The architect's summary sits at the top.

**Actions**

| Change set | Actions |
|---|---|
| A staff proposal | Build it (Approve), Send back… (with a note), Kill, Defer |
| The CEO's draft | Build it (Save), Keep building |

- **A stale proposal:** if the site changed since the proposal was made, the booklet says so; approving it would fail on the stale hash.

**Step states**
- Each step's model is the base with the changes up to that step applied, by the server's own `apply_changes` (blueprint-wasm). So what the booklet shows is what approving builds.

**Planned**
- **Partial approval:** skip steps and build only some of them. Today Approve applies the whole change set; partial approval needs an ADR.
- **Build-order assembly:** after Build it, the town rebuilds storey by storey.

## 5. Who builds what

| Who | How | Lands through |
|---|---|---|
| CEO | the Studio's workbenches, brick by brick | Review your build, then Build it: `PUT /api/site/blueprint` on the base hash (409 if stale, 422 with the issues) |
| Information Architect (UX designer) | a construction site or Ask the architect | a proposal, then `StructureApproval`, then the booklet, then Build it (Approve) |
| Web Developer | a construction site in the factory district or Ask for a tool | the same, with the tool booklet (planned) |
| Art Director | design import (HTML or ZIP) | merged into the CEO's draft, then reviewed like any other draft |

The orchestrator owns the transitions (rule 3). No model output is applied without the CEO's Build it, unless the autonomy policy delegates it (ADR-0059).

## 6. Architecture (slice 1)

| Piece | File |
|---|---|
| The Studio (the Blueprint panel, full screen) | `apps/game/src/ui/components/Blueprint.tsx` |
| Brick primitives, tray, sound | `apps/game/src/ui/studio/bricks.tsx` |
| Snap engine (pure) | `apps/game/src/ui/studio/snap.ts` |
| Undo / redo (pure) | `apps/game/src/ui/studio/history.ts` |
| Booklet steps (pure) | `apps/game/src/ui/studio/steps.ts` |
| Building workbench and elevation | `apps/game/src/ui/studio/Building.tsx` |
| Booklet view | `apps/game/src/ui/studio/Booklet.tsx` |
| The proposal for the booklet | `ArticleRecord.structure` (`ui/data-source.ts`, parsed in `ui/wasm-source.ts`) |
| `applyChanges` | `apps/game/src/blueprint/wasm.ts`, over `crates/blueprint-wasm` |
| The Inbox's "Open the booklet" | `apps/game/src/ui/components/Inbox.tsx` (`StructureProposal`) |

**Rendering**
- Everything is SVG in Preact: no canvas library, and no WebGPU for the editors.
- The 3D town keeps its own renderer (`render/bricks/`) and reads the same models.

## 7. Increments

| Id | What | Status |
|---|---|---|
| FEAT-100 | The Studio: workbenches, the grammar, undo, the Building workbench (page builder) | built (slice 1) |
| FEAT-101 | The instruction booklet: the CEO's draft and staff proposals | built (slice 1) |
| FEAT-102 | Town: info views and construction-site zoning | planned |
| FEAT-103 | Factory: the tool graph editor in the grammar (built); recipes, typed couplings, test-run replay, n8n as a booklet (planned) | in progress |
| FEAT-104 | Paint shop: style sets, palette and type tiles, the preview | planned |
| — | Partial approval; the layout saved to `blueprint/layout.json`; a page preview in the Building workbench; tool binding by tube | later |
