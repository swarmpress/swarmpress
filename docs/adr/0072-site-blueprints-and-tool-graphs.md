# ADR-0072 — Site blueprints and tool graphs, built in bricks

**Status:** Accepted (not built; builds on ADR-0014, ADR-0042, ADR-0043, ADR-0053, ADR-0063, ADR-0065)
**Date:** 2026-10-06

## Context

The owner's "construction kits" concept (`docs/reference/construction-kits.md`, 2026-10-06) asks for
two semantic models:
- a **website blueprint**: page types, blocks, collections, relationships and design intent;
- **tool graphs**: n8n-like workflows of inputs, connectors, operations, conditions, agent steps and
  outputs.

A shared type system joins the two, and AI generates the implementation from them. The owner also
asked how this can be drawn in the brick world, with bricks standing for flows and site structure.

swarm.press has many of the parts but not the model:
- **Blocks:** a block catalogue with intent metadata (`BlockMeta`) exists only in Rust.
- **Page types:** `page_type` is a free string, and only one type has rules (`article_profile.rs`).
- **Structure:** relationships and navigation are implicit.
- **Tools:** SDK skills declare typed tools, but they are written by hand in JavaScript, and the game
  does not load extensions.
- **Bricks:** the construction kit compiles JSON designs deterministically, but its ports mean physical
  attachment only.

The owner decided on 2026-10-06 that this is an **in-game layer**: the CEO and the staff build the
blueprint and the tools inside the dollhouse. swarm.press stays a management sim. The design is
`docs/design/construction-kits.md`.

## Decision

1. **Two semantic models in the site repo.** `blueprint/site.json` (`swarmpress.blueprint.v1`), named
   types in `blueprint/types/`, and one `blueprint/tools/<id>.tool.json` (`swarmpress.tool.v1`) per tool
   live in the player's site repo (ADR-0047). Each has a domain-separated semantic hash. Editor positions
   are stored apart (`blueprint/layout.json`) and are not part of the hash. A new `structure` write root
   in `PathPolicy` is reserved for a structure actor.
2. **Page types become data.** The blueprint's page types and their slots replace the hard-coded
   article profile. `page_type` becomes a closed-world id (rule 5). `BlockMeta` moves to data that Rust
   and TypeScript share. Until the site-kit cutover, the blueprint references the manifest's ids and
   never restates them; after it, the manifest's structural parts are derived from the blueprint.
3. **One type system.** Types are a restricted JSON Schema subset (closed objects, arrays, scalars,
   enums, references, `LocalizedString`). Compatibility is structural, and one checker serves block
   slots, tool ports and the bindings between them.
4. **Tools are graphs over a closed node catalogue, and they compile to skills.**
   - The node kinds are input, output, connector, op, condition, agent and skill. There is no free-code
     node: code lives in reviewed SDK skills.
   - A graph installs as a `skill` extension. Its manifest's capabilities, origins and limits are
     derived from the graph, and its bundle is one shared interpreter.
   - It is therefore sandboxed, capability-gated and installed through the CEO's ticket (ADR-0053).
5. **Bindings run at build time first.** In v1 a block bound to a tool reads the tool's output, which
   is committed as typed data (`content/data/<tool>/…`) when a page is drafted or refreshed, or on the
   tool's schedule. Running a tool per visitor needs hosted compute and a separate ADR.
6. **Bricks are compiled views.**
   - A pure, golden-tested generator turns the blueprint and its tools into one `swarmpress.design.v1`
     design, the **town**:
     - page types are modular buildings;
     - slots are storeys coloured by block intent;
     - globals are shared roofs and foundations;
     - collections are warehouses;
     - relationships are skywalks;
     - tools are machines in a factory district, with hoppers, dishes, gearboxes, switches, staff
       workstations and chutes;
     - typed tubes have coupling shapes.
   - The town carries a `View` provenance and is never edited brick by brick.
   - It is drawn as a miniature on a model table in the office and at full scale in a Blueprint view.
7. **Authoring is a flat brick canvas.** It is a top-down Preact and SVG editor in the overlay, with a
   parts bin restricted to the closed catalogues and live type checks. It has simple and advanced
   inspector modes. The 3D town is for watching and inspecting, not for editing.
8. **The orchestrator and the CEO own changes.**
   - The CEO's edits land directly.
   - Staff and extensions return semantic diffs as artifacts, applied only through a `StructureApproval`
     ticket whose default never applies the diff.
   - The sim sees digests only: `BlueprintChanged`, `ToolInstalled`, `ToolRunCompleted` and
     `ToolRunFailed`.
   - New work kinds are `Structure` and `Tool` work items, and the `Architect`, `ToolBuild`, `ToolRun`
     and `ThemeCode` jobs.
   - The render state gains the model table and the installed tools by id and hash.
9. **The concept's agents are staff.**
   - A new Information Architect role proposes blueprints.
   - The Web Developer builds tools and themes.
   - The Art Director interprets imported designs.
   - Repair is the existing maintain flow and site audit.
10. **Import before invention.** The first blueprint is reverse-engineered deterministically from the
    live cinqueterre.travel, read-only. HTML and ZIP import (which covers Claude Design exports) and n8n
    import come later. Unknown n8n nodes become sealed steps that block the tool (rule 11). A live
    Claude Design connection waits for a public API.

## Consequences

- Positive:
  - The biggest structural gap, page types as data, closes first and is useful on its own.
  - The brick world gains a meaning beyond decoration: the town shows the company's site and tools.
  - User-built tools reuse the sandbox, capabilities, limits, install ticket and provenance instead of a
    new runtime.
  - The type system is shared, so a wrong connection is visible as a red seam and reported as an issue.
- Positive: the implementation (theme, templates) becomes regenerable from a stable semantic model,
  which the concept's versioning section asks for.
- Negative:
  - There are new formats, a new crate (`crates/blueprint`), a new package (`packages/toolgraph`) and
    a render-state contract change, before any player sees value.
  - Until the cutover, the blueprint and the site manifest overlap and must be kept consistent by a
    check.
- Negative:
  - The concept's showcase case (weather per visitor) is out of v1, because the site is static.
  - Agent tool calls on the hosted model need a server-to-browser round trip that is not designed yet.
  - The game must start loading extensions (FEAT-054/056) before any tool runs in the browser.
- Negative: an n8n-like editor invites scope creep. The closed node catalogue and the "code lives in
  skills" rule are the guard, and they will frustrate some advanced users.

### Alternatives considered

- **Bricks as the source of truth.** Players would build the site's structure brick by brick in 3D, and
  meaning would be read off the bricks. Rejected: meaning would depend on geometry, edits would be
  imprecise, and the result would duplicate player building (FEAT-026). Bricks stay a view.
- **Adopting n8n (or Node-RED) as the tool runtime.** Rejected: it would add a server process and a
  queue against rule 13, it runs outside the sandbox against rule 14, and it would bypass the lease and
  the spend gates. Import from n8n is kept.
- **A free-code node in tool graphs.** Rejected: code would escape review and provenance. Skills already
  provide reviewed, sandboxed code.
- **A blueprint stored in the store or the sim, not the repo.** Rejected: the player owns the site
  repo, structure belongs with the content it shapes, and text never enters the sim.
- **Treating the concept as a product pivot.** The owner chose an in-game layer.
