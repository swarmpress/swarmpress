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
  - "apps/game/src/render/bricks/town.ts"
  - "apps/game/src/ui/components/Blueprint*.tsx"
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

## Acceptance criteria

- [ ] The blueprint format, its semantic hash and the checker have golden and invalid fixtures; editor
      positions do not change the hash.
- [ ] The town generator is deterministic (golden design hashes) and compiles with `crates/kit`.
- [ ] A CEO edit on the canvas commits the blueprint through the gateway under the structure root only.
- [ ] A semantic diff marks additions, removals and changes by stable id on the canvas and the town.

## Evidence

- `kit/nextest`
- `game/vitest`
