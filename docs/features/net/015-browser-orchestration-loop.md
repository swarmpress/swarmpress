---
id: FEAT-015
title: "Browser orchestration loop"
status: planned
importance: critical
paths:
  - "apps/game/src/orchestration/**"
  - "crates/client-wasm/src/orchestrator*.rs"
  - "apps/game/e2e/mvp.spec.ts"
adrs:
  - ADR-0011
  - ADR-0038
---

# Browser orchestration loop

Replaces "Postgres job queue" (ADR-0008 was superseded by ADR-0039).

The loop works like this:
1. Drain `Effect::RequestJob` from the wasm sim.
2. Run the job through the `orchestrator` crate (wasm), with the browser store, local LLM staff
   and the central gateway.
3. Apply the resulting `MeetingOutcome` / `JobCompleted` / `DeployLanded` as commands at the
   next step boundary.
4. Append those commands to the command log.

Jobs are idempotent by `job_id`, so a crash or reload re-runs them safely.

Acceptance: the MVP loop in `docs/mvp.md` passes end to end in `apps/game/e2e/mvp.spec.ts`.
