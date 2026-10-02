---
id: FEAT-014
title: "Offline catch-up and fast-forward"
status: in-progress
importance: high
paths:
  - "apps/game/src/catchup/**"
  - apps/game/src/session/session.ts
  - apps/game/e2e/mvp.spec.ts
  - "packages/runner/test/**"
adrs:
  - ADR-0020
  - ADR-0036
  - ADR-0038
---

# Offline catch-up and fast-forward

On reopen, the browser restores its last snapshot and fast-forwards the deterministic sim to the
current wall-clock step. While it does, the **fallback director** stands in for LLM-driven
decisions. Events that queued centrally while the browser was closed, for example
`DeployLanded`, are merged in step order.

What exists today (`apps/game/src/catchup/replay.ts`, used by `restore()` in
`apps/game/src/session/session.ts`):
- client-wasm exports no world snapshot yet, so restore is a **replay**: the sim is created from
  the scenario and seed, and the command log is applied at the logged steps, from the browser
  store or, if that is empty, from central sync (FEAT-012).
- The replay stops at the last checkpoint's step and compares the world hash with the
  checkpoint's.
- Jobs whose outcome is not in the log are queued again. Central events after the stored cursor
  are applied at the next step boundary.

Still to do: fast-forward to the wall-clock step, and the fallback director.

Acceptance:
- Fast-forwarding a week finishes within the budget on a laptop-class device.
- The result is identical whether replayed in the browser or in the headless runner.
