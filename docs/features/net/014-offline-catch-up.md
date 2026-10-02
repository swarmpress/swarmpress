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
- Restore starts from the newest world snapshot (FEAT-060): the sim is rebuilt from its bytes,
  checked against the record's step, hash and seed, and only the commands logged after it are
  applied at their logged steps. The record comes from the browser store or, if that is empty,
  from central sync (FEAT-012).
- A record without a world (written before FEAT-060) is restored by **replay**: the sim is
  created from the scenario and seed, the whole log is applied, and the world hash is compared
  with the checkpoint's at its step. `?restore=replay` forces this path as an audit.
- Jobs whose outcome is not in the log are queued again. Central events after the stored cursor
  are applied at the next step boundary.

Still to do: central-first restore (FEAT-012), and letting the day finish before the company
rests.

The host-side clock rules that make game time independent of GPU speed (hold while work is due,
clamp, rest, hidden tab) are FEAT-080 (ADR-0060).

Acceptance:
- A restore reproduces the checkpoint hash, or aborts.
- Restore time is bounded by the commands after the newest snapshot (with FEAT-060).
- The result is identical whether replayed in the browser or in the headless runner.
- No game time passes, and no payroll is charged, for wall-clock time with no executor.
