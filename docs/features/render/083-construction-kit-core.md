---
id: FEAT-083
title: "Construction kit core: parts, designs and the kit compiler"
status: in-progress
importance: high
paths:
  - "crates/kit/**"
  - "crates/kit/tests/**"
  - "crates/kit/benches/**"
  - "crates/kit-wasm/**"
  - "crates/kit-wasm/tests/**"
  - "kit/**"
  - "apps/game/src/render/bricks/**"
adrs:
  - ADR-0065
  - ADR-0063
  - ADR-0056
---

# Construction kit core

The foundation every brick in the game comes from: a part catalogue (`kit/parts/*.json`), the
design format (a closed brick script with parameters, ports, tags and provenance, hashed as
content), and `crates/kit`, a deterministic compiler (native and wasm) that expands a design,
validates it (connected, within footprint and budgets), splits it into standard bricks with
overlapping rows and studs only where visible, and derives a summary of capabilities (footprint,
tags, seats, workstation, light, storage, screens, surfaces, part count, cost).

The MVP ships designs for every `EquipmentKind` and room shells for every `RoomKind`, ported from the
prototype's builders (`docs/reference/brick-office/prototype.html`). The sim is unchanged in the MVP;
the renderer maps equipment and room kinds to shipped designs.

Design: [`docs/design/construction-kit.md`](../../design/construction-kit.md) (sections 2–4, increments
K-1 and K-2).

## Acceptance criteria

- [ ] The same design, parameters and kit version compile to identical bricks and summaries natively
      and in wasm (golden test).
- [ ] Invalid designs (unknown part or colour, floating bricks, outside the footprint, over budget,
      cyclic `use`) are refused with issues that name the operation.
- [ ] Every shipped equipment design summarises to the sim's capabilities for that kind (a desk is a
      workstation with a screen port and a lamp port).
- [ ] A design's hash is stable for its canonical form and changes with any edit.
- [ ] Compile time of a room within the target, measured.

## Evidence

- `kit/nextest`
- `game/vitest`
