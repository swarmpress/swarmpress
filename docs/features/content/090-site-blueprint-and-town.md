---
id: FEAT-090
title: "Site blueprint: the semantic model, the brick town and the blueprint canvas"
status: in-progress
importance: normal
paths:
  - "crates/blueprint/src/**"
  - "crates/blueprint/tests/check.rs"
  - "crates/blueprint/tests/town.rs"
  - "crates/kit/src/design.rs"
  - "apps/game/src/render/bricks/model.ts"
  - "apps/game/src/render/bricks/model.test.ts"
  - "apps/game/src/blueprint/**"
  - "apps/game/src/ui/components/Blueprint*.tsx"
  - "apps/game/src/ui/blueprint/**"
  - "crates/server/src/site_blueprint.rs"
  - "crates/server/tests/site_blueprint.rs"
adrs:
  - ADR-0072
  - ADR-0065
  - ADR-0063
---

# Site blueprint: the semantic model, the brick town and the blueprint canvas

After the MVP (increments B-1 and B-2). `blueprint/site.json` (`swarmpress.blueprint.v1`) in the
site repo holds the site's page types, slots, globals, collections, relationships, navigation and
design intent, together with named types and one checker for type compatibility. A pure generator
compiles the blueprint into a kit design, the town:
- page types are modular buildings;
- slots are storeys coloured by block intent;
- globals are shared roofs and foundations;
- collections are warehouses;
- relationships are skywalks.

The town is drawn as a miniature on the model table and at full scale in the Blueprint view. The CEO
edits on a flat brick canvas with a closed parts bin and live type checks. Changes are semantic
diffs.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §3 to §6.

Depends on: FEAT-089, FEAT-081 (brick office renderer), FEAT-079 (approval tickets).

## As built (2026-10-06)

- **The crate.** `crates/blueprint` holds the format, the type system, the checker, the semantic hash,
  diffs that apply back, and the town generator (`town.rs`, a `swarmpress.design.v1` with
  `provenance: view`).
- **The server.** `GET /api/site/blueprint` answers the stored blueprint, or one imported from the
  pages, with its tools, issues and town, cached per commit.
- **The browser.** The session reads the models at boot and on each game day into the overlay
  store (`siteModels`). Behind `?office=bricks`, the brick office stands a meeting table in the
  first planning room it builds (strategy room, design studio, editor's office, newsroom) and puts
  the town on it, scaled to fit, at most 1/8. It rebuilds only when the town changes.
- **The canvas.** The overlay's Blueprint panel (key B) is offered once the source has the site's
  models. Its Blueprint tab draws the blueprint flat in SVG on a stud grid: a building per page type
  in the town's street order, a storey per slot in page order coloured by its first block's intent
  (the town's palette ids, `apps/game/src/blueprint/colours.ts`; optional storeys striped), globals as
  roof and foundation bands, a pipe on a storey a tool feeds, relationships as walkways and
  collections as warehouses. The CEO edits a draft (parts bin of the closed catalogue and the site's
  blocks, page types, storeys, blocks, min and max, relationships), an imported blueprint only after
  "Start editing from this import". Each edit is checked and diffed in the browser by
  `blueprint-wasm`, loaded lazily: issues mark storeys red, additions are outlined green, removals
  ghosted, changes yellow. Save sends `PUT /api/site/blueprint` with the base hash and reloads the
  models; a 422 shows the server's issues, a 409 offers a reload. The inspector has a simple view in
  words and an advanced view with the JSON. The Tools tab draws each tool as a machine in the
  layered layout (layer = longest path from a source, ordered by id), tubes coloured by type, with
  its triggers, manifest and issues; it is read-only until T-1. Building positions are kept in the
  panel for now, not in `blueprint/layout.json`.

## Acceptance criteria

- [ ] The blueprint format, its semantic hash and the checker have golden and invalid fixtures; editor
      positions do not change the hash.
- [ ] The town generator is deterministic (golden design hashes) and compiles with `crates/kit`.
- [ ] A CEO edit on the canvas commits the blueprint through the gateway under the structure root only.
- [ ] A semantic diff marks additions, removals and changes by stable id on the canvas and the town.

## Evidence

- `kit/nextest`
- `game/vitest`
