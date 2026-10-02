---
id: FEAT-027
title: "Overlay UI (CEO management: Plan, Inbox, Org, Projects, Finance, Performance, Hiring, HUD)"
status: in-progress
importance: high
paths:
  - "apps/game/src/ui/**"
  - "apps/game/e2e/ui.spec.ts"
adrs:
  - ADR-0018
---

# Overlay UI (CEO management)

Preact DOM overlay over the dollhouse (ADR-0018). The CEO's instruments:

- **Plan** (primary): board, calendar, timeline, workload and goals; work-item detail with brief,
  phases, todos and the live **thread** (posts of every type in publishing-plan.md §2, including
  the orchestrator's `minutes` / `artifact` / `handoff` / `review` / `status` posts with `payload`).
- **Inbox** (Secretary): tickets by priority with deadline countdowns and option buttons;
  delegation policy; secretary task queue; Delegate menu (disabled with a reason without a
  secretary).
- **Org chart** and **profile cards** (persona catalog, organization.md §3): praise, promote,
  salary, project allocation (100% rule, validated by the source), fire.
- **Projects**, **Finance** (CFO; explicit "No CFO — books not reviewed" state),
  **Performance** (KPIs, KPI report), **Hiring** (candidate pool).
- **HUD**: cash, runway, open/high tickets.

Data comes through the async `GameDataSource` interface (`apps/game/src/ui/data-source.ts`):
`MockDataSource` (fixtures + in-memory rules, `?ui=mock`) and `WasmDataSource`
(feature-detected `Sim.org_json/finance_json/inbox_json/plan_json/apply_command_json`, the default
now that client-wasm exports them; plan text from the CompanyStore via `planTextFromStore`).
Every action is a JSON command (`commands.ts`); nothing mutates the replica
directly. Frozen screenshot pages (`?t=`) don't mount the overlay unless `?ui=` is given, so the
visual baselines are unaffected.

Decisions: [ADR-0018](../../adr/0018-overlay-ui-in-preact.md).

## Acceptance criteria

- Components tested with @testing-library/preact (`src/ui/*.test.tsx`).
- axe reports no violations on every panel (vitest + axe-core; colour contrast in Playwright).
- Every action produces a command through `GameDataSource.apply`; nothing mutates the replica directly.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
