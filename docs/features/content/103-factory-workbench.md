---
id: FEAT-103
title: "The Factory workbench"
status: in-progress
importance: medium
paths:
  - apps/game/src/ui/studio/Factory.tsx
  - apps/game/src/ui/studio/machines.ts
  - apps/game/src/ui/studio/factory.test.tsx
  - apps/game/src/ui/components/Blueprint.tsx
  - apps/game/e2e/studio.spec.ts
adrs:
  - ADR-0077
  - ADR-0072
  - ADR-0076
---

# The Factory workbench

The site's tools built in the Studio's grammar ([ADR-0077](../../adr/0077-the-brick-studio.md);
[design](../../design/brick-studio.md) §3.3). The Factory tab has two views: the Workbench, and
Machines and imports (the overview with n8n import, credentials and Run now; FEAT-091, FEAT-096).

## Built

- The tray: the closed node catalogue in groups (in and out, fetch, shape, decide, staff); a
  click places a machine with defaults that need no further setting. An input or output declares
  its port on the tool.
- Tubes: pick an outlet, and every inlet lights green where the site's tool checker
  (`check_tool`, blueprint-wasm) accepts the tube, or a red seam with its reason. An inlet takes one
  tube.
- The inspector: a machine's settings in words (Simple) or as JSON (Advanced); the tool's name,
  description, trigger and the types it takes and makes; remove a machine or a tube (also with
  Delete).
- New tools, undo and redo, the changed tools saved through `PUT /api/site/blueprint` (`tools`,
  on the base hash), with the server's issues on a refusal.
- Tests:
  - `apps/game/src/ui/studio/factory.test.tsx`: ports as in tools.rs; every tray part checks as
    placed on the real checker; tube verdicts; building and saving a tool in the Studio; axe;
  - `apps/game/e2e/studio.spec.ts`: a tool built and saved in the real game page.

## Not built

- Recipes (prefab tools in the tray).
- Test-run replay of the interpreter's trace in the tubes.
- Typed couplings (round, square, ribbed) on the ports.
- A booklet review for tool changes and n8n imports.
- Binding a tool to a storey by tube from the Building workbench.
