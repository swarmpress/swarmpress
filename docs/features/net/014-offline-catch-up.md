---
id: FEAT-014
title: "Offline catch-up: restore and resume"
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
  - ADR-0048
  - ADR-0060
---

# Offline catch-up: restore and resume

Game time is **executor time** (ADR-0048, which supersedes the wall-clock fast-forward of
ADR-0020 and ADR-0038): the clock advances only while an executor works the company. With no
executor, the day may finish and the company then rests. On reopen the browser restores the last
sealed state and resumes from that step; it does not fast-forward to the wall clock. Events that
queued centrally while the browser was closed, for example `DeployLanded`, are merged in step
order.

No fallback director is needed for correctness: standups time out after 60 game minutes and
tickets resolve to their default at the deadline. A director (ADR-0036) is optional flavour.

What exists today (`apps/game/src/catchup/replay.ts`, used by `restore()` in
`apps/game/src/session/session.ts`):
- client-wasm exports no world snapshot yet, so restore is a **replay**: the sim is created from
  the scenario and seed, and the command log is applied at the logged steps, from the browser
  store or, if that is empty, from central sync (FEAT-012).
- The replay stops at the last checkpoint's step and compares the world hash with the
  checkpoint's.
- Jobs whose outcome is not in the log are queued again. Central events after the stored cursor
  are applied at the next step boundary.

Still to do: restore from a world snapshot instead of the seed (FEAT-060), central-first
restore (FEAT-012), and letting the day finish before the company rests.

The host-side clock rules that make game time independent of GPU speed (hold while work is due,
clamp, rest, hidden tab) are FEAT-080 (ADR-0060).

Acceptance:
- A restore reproduces the checkpoint hash, or aborts.
- Restore time is bounded by the commands after the newest snapshot (with FEAT-060).
- The result is identical whether replayed in the browser or in the headless runner.
- No game time passes, and no payroll is charged, for wall-clock time with no executor.
