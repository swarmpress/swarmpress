# ADR-0077 — The Brick Studio

**Status:** Accepted (extends ADR-0072 §5 and §7 and design construction-kits.md §5; 3D stays watch-only, as ADR-0072 §7 decided)
**Date:** 2026-10-08

## Context

The site's structure, its tools, its pages and its theme are edited in the game (ADR-0072). Today that means:
- a wide panel with a flat SVG brick canvas, a parts bin and an inspector;
- a read-only tools tab;
- staff proposals reviewed as a plain change list in the Inbox.

The owner wants this interface to be game-like, very intuitive and very powerful, built on the game's own brick idea: blocks, combining blocks, workflows made of blocks. The references are Cities: Skylines and the LEGO Builder app. The owner then decided two things:
- **no 3D for building**, because it would be too tricky for users, especially in the page builder and the tools;
- **both zone and build:** the CEO builds directly, and can also ask staff to build, reviewing the result step by step.

The design is in [docs/design/brick-studio.md](../design/brick-studio.md).

## Decision

1. **A full-screen, flat Studio.** The Blueprint panel becomes the Brick Studio, a layer over the whole screen with workbenches:
   - **Town:** the site as a street of buildings; info views and zoning come later;
   - **Building:** one page type from the front, i.e. the page builder;
   - **Factory:** the tools as machines;
   - **Paint shop:** the theme, later.

   All of them are SVG in the overlay. The 3D brick town stays where the site is watched (ADR-0072 §7).
2. **One grammar for every workbench:**
   - **pick** a part from the tray;
   - **see** where it may go: green studs where the site's checker (blueprint-wasm, the server's own code) accepts it, a red seam with the checker's reason where it does not;
   - **snap** it in;
   - **bulldoze** it;
   - **undo and redo** it.

   A drop is allowed when it adds no issue the draft did not already have, so nothing the server would refuse can be built. Every verb has a key, and motion respects `prefers-reduced-motion`.
3. **The instruction booklet reviews every change set.** This covers a staff proposal at its `StructureApproval`, the CEO's own draft before it is saved, and (later) an n8n import.
   - **Layout:** one numbered step per semantic change, in bags per building in street order, with the site-wide changes last.
   - **Each step:** the base with the changes up to it applied (`apply_changes`), shown as the building it works on with the touched storeys outlined, plus a callout of the parts added and taken away.
   - **"Build it":** for a proposal it is the ticket's Approve; for the CEO's draft it is the save (`PUT /api/site/blueprint` on the base hash).
   - **Approval stays whole:** Approve applies the whole change set.
4. **The booklet's proposal** is read from the work item's artifact in the company store (`ArticleRecord.structure`: the whole proposed blueprint and its changes). It is shown against the site's current blueprint, and a stale proposal says so.
5. **Construction-site zoning and info views** (planned) are the Town's way in to the existing `Commission` flow and to facts the game already has: the checker's issues, tool supply, the site audit, the analytics loop and translations. They add no new authority: proposals still pass the CEO.
6. **The platform's page types keep their storeys.** The Building workbench marks them and disables the tray for them, because the checker refuses any change to them.

## Consequences

- **What the CEO gains:**
  - the CEO builds pages and structure with direct manipulation and learns one grammar for every editor;
  - the CEO reviews staff work the way a brick set's instructions read;
  - what the booklet shows is what approving builds, because it uses the server's code.
- **Fit with the game's rules:** the closed world, the shared checker, the authority rules and the text-is-data rule are unchanged.
- **Negatives:**
  - **checker cost:** every candidate drop runs the checker; on a type with many storeys that is a few dozen checks when a part is picked up (milliseconds in wasm, still work);
  - **SVG at scale:** SVG elevations and maps may get slow on very large sites (64 page types, 32 storeys each), and will need virtualisation then;
  - **local proposals only:** the booklet needs the proposal in this device's store; ADR-0075 syncs it with the log, but only as far as the last seal;
  - **partial approval deferred:** the sim's Approve applies the whole diff, so skipping steps needs its own decision;
  - **unfamiliar labels:** the workbench names (Town, Building, Factory) replace the Blueprint/Tools tabs that players and tests knew.
- **Alternatives:**
  - **A 3D build mode** in the brick town, with Builder-app placement: rejected by the owner as too tricky.
  - **A node-graph or form editor** without the brick grammar: it would be powerful but neither game-like nor consistent with the dollhouse.
  - **Keeping the wide panel:** too small for a tray, an elevation and an inspector side by side.
