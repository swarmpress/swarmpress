---
id: FEAT-101
title: "The instruction booklet"
status: in-progress
importance: high
paths:
  - apps/game/src/ui/studio/steps.ts
  - apps/game/src/ui/studio/Booklet.tsx
  - apps/game/src/ui/studio/studio.test.tsx
  - apps/game/src/ui/components/Inbox.tsx
  - apps/game/src/ui/data-source.ts
  - apps/game/src/ui/wasm-source.ts
  - apps/game/src/blueprint/wasm.ts
  - apps/game/e2e/studio.spec.ts
adrs:
  - ADR-0077
  - ADR-0072
---

# The instruction booklet

Every change set reviewed like a brick set's instructions ([ADR-0077](../../adr/0077-the-brick-studio.md)
§3): one numbered step per semantic change, in bags per building, each step the base with its
prefix of changes applied by the server's own `apply_changes`. The building it works on is drawn
with the touched storeys outlined, beside a callout of the parts added and taken away.

## Built

- The CEO's draft: Review your build, then Build it saves (`PUT /api/site/blueprint`), or Keep
  building.
- A staff proposal: "Open the booklet" on a structure-approval ticket. Build it (Approve), Send
  back… (opens the note), Kill, Defer, and a warning when the site changed since.
- `applyChanges` on the wasm facade; `ArticleRecord.structure`, the whole proposal from the
  artifact.
- Tests: `apps/game/src/ui/studio/studio.test.tsx` (steps and bags against `apply_changes`, the
  Inbox booklet answering the ticket, axe); `apps/game/e2e/studio.spec.ts`.

## Not built

- Partial approval (skipping steps).
- The build-order assembly animation in the town.
- The tool booklet and n8n import as a booklet.
