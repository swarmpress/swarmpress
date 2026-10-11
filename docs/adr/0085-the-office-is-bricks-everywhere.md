# ADR-0085 — The office is bricks everywhere

**Status:** Accepted (amends ADR-0063 decision 7, the gated rollout; FEAT-081)
**Date:** 2026-10-11

## Context

ADR-0063 decided the brick office and gated its rollout on a spike (FEAT-081): two rooms behind
`?office=bricks`, measured idle and while the model generates, with the full rollout, and whether it
is part of the MVP, decided on the numbers. The spike was built on the construction kit (ADR-0065)
on 2026-10-04; its go/no-go run on the qualification machine has not been made.

Since then the brick look has become the product's visual language beyond the office: the Brick
Studio and its workbenches (ADR-0077), the Paint shop, the town of the site's page types (ADR-0072,
ADR-0082) are all drawn in bricks with the kit's palette. An office in boxes next to editors in
bricks is two products. The owner decided on 2026-10-11: **the bricks style everywhere**, the
people included.

A first measurement with every room in bricks (the demo layout's eleven rooms, about 43,000 parts,
630 draw calls, a 1.5 s build) ran at 100 to 120 fps on the owner's machine in Chrome with WebGPU.

## Decision

1. **The office is bricks, by default and only.** Every room, the hallway and the street are built
   from the kit: rooms from their shells (`kit/rooms.json` `styles`), the floors outside the rooms
   from **ground shells** (`grounds`: `hallway`, `street`; baseplates and a floor edge to edge, no
   walls, chunked like rooms; `kit::ground_shell`, `groundShell` in kit-wasm). The `?office=bricks`
   flag is removed.
2. **People are brick characters** of the product's own design (ADR-0063 decision 8 stands): block
   legs, a torso brick with shoulder studs, a square head with a 2 × 2 hair plate and eyes, arms at
   the sides that become forearms when typing, on the FEAT-024 rig. Not a copy of any toy maker's
   figure: the minifigure's shape is a registered three-dimensional trade mark in the EU.
3. **The spike's numbers become a budget, not a gate.** ADR-0063's targets (p95 ≤ 33 ms idle and
   ≤ 50 ms while generating at the lowest tier on the qualification machine; a room chunk in
   < 200 ms) stay FEAT-081's acceptance criteria. Missing them is a performance defect to fix
   (level of detail, merged static chunks, a cheaper stud path), not a reason to return to boxes.
4. **Level of detail starts now** (ADR-0063 decision 5): the floor layers, flat and studless, are
   painted into one plane per room from the kit's tiles at every tier; at the low tier the shells'
   touching bricks are merged per colour. The kit stays the truth for both: the renderer only
   draws its output more cheaply.
5. **The box office becomes the scene's skeleton.** Its lights, labels, picking and the people's
   rig stay; its geometry is switched off where bricks stand, and its builders retire once nothing
   reads them.

## Consequences

- One visual language: the office, the people and every editor (Studio, Paint shop, town) share the
  kit's bricks and palette.
- The scene's cost rises from the box office's: every room's bricks are built at boot and drawn every
  frame. Under software WebGPU (CI) the demo office ran at 1.8 fps against the box office's 16;
  the baked floors and the low tier's merged walls bring it to about 5. Distance-based level of
  detail per chunk is not built yet.
- Visual baselines (FEAT-028) change; they are retaken on Linux x86_64 in the Playwright container.
- The kit gains a second shell kind (grounds) that the renderer and tests depend on.
- **Negative:**
  - Shipped without the go/no-go run: on a weaker GPU the office may fall below budget until level
    of detail lands, and there is no box fallback to switch to.
  - The brand risk of the toy-brick look (ADR-0063) now covers the people too; the character
    design is the mitigation, not a guarantee. Not legal advice.
  - The box office's code stays as a skeleton for now, so the office still has two builders until
    it is reduced.
- **Alternatives rejected:**
  - *Keep the gate and wait for the spike's run.* Keeps two visual languages in the product
    meanwhile, against the owner's decision.
  - *Bricks behind a setting, boxes as the default or a fallback.* Two looks to test and maintain;
    performance is to be fixed in the bricks instead.
  - *Minifigure-like people.* A registered shape and a recognisable trade dress; our own figure
    carries the look without copying it.
