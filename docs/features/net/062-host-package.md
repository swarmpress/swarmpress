---
id: FEAT-062
title: "Shared executor host package (packages/host)"
status: planned
importance: high
paths:
  - "packages/host/**"
  - apps/game/src/session/session.ts
adrs:
  - ADR-0048
  - ADR-0042
---

# Shared executor host package

Increment A5. The pieces that run a company are host-agnostic TypeScript but live under
`apps/game/src`. This feature moves them, without behaviour change, into `packages/host` so the
browser and the runner execute the same code:

- `catchup/replay.ts`, `orchestration/loop.ts`, `sync/{uploader,segments}.ts`;
- `store/{company-store,schema,driver}.ts` and `net/central.ts`;
- the shape and adapter half of `orchestrator/bridge.ts`;
- `restore()` and the lease, loop, events and checkpoint wiring of `startSession`, as an
  `Executor` class.

Hosts inject the `SqlDriver`, the sim and orchestrator factories, the LLM bridge and timers. The
browser session becomes a thin host around `Executor`.

Depends on: FEAT-060, FEAT-061. FEAT-063 depends on it.

## Acceptance criteria

- [ ] Pure moves: the existing vitest, bun and Playwright suites stay green with no assertion
      changed.
- [ ] `packages/host` imports nothing browser-only (`window`, `location`, OPFS, Web Locks).
- [ ] The package's tests run under both vitest and bun.

## Evidence

- `game/vitest`
- `game/playwright-mvp`
- `runner/bun-test`
