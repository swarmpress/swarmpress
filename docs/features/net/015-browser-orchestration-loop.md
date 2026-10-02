---
id: FEAT-015
title: "Browser orchestration loop"
status: in-progress
importance: critical
paths:
  - "apps/game/src/orchestration/**"
  - "apps/game/src/session/**"
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0011
  - ADR-0038
  - ADR-0058
  - ADR-0060
---

# Browser orchestration loop

Replaces "Postgres job queue" (ADR-0008 was superseded by ADR-0039).

The game page runs it with `?central=1` (`apps/game/src/session/session.ts`: dev login, company,
lease, company store, restore, then the loop). Without the parameter the page stays the offline
demo.

The loop (`apps/game/src/orchestration/loop.ts`) works like this:
1. Drain `Effect::RequestJob` from the wasm sim.
2. Run the job through the `orchestrator` crate (its wasm bridge is FEAT-059), with the browser
   store, a `LocalLlm` and the central gateway.
3. Apply the resulting `MeetingOutcome` / `JobCompleted` as commands at the next step boundary.
   `DeployLanded` arrives as a central event and is applied the same way.
4. Append those commands to the command log.

Jobs are idempotent by `job_id`, so a crash or reload re-runs them safely.

Not there yet: the session has no real local model. Without `?llm=fake` (the scripted MVP
model) every job fails loudly.

Acceptance: the MVP loop in `docs/mvp.md` passes end to end in `apps/game/e2e/mvp.spec.ts`.

MVP increments on this loop (`docs/mvp.md`): the due-step clock hold and earliest-due queue
(FEAT-080, ADR-0060); stage progress, timeout and cancel (FEAT-032, ADR-0058); the utterance queue
for speech bubbles (FEAT-025); the deploy watchdog (FEAT-047); the orphan sweeper (FEAT-039); and
bounded growth with a 7-day soak test (track W: ring buffers for the bridge call log, gateway calls
and received events; `loop.jobs` capped; no full plan parse per step).
