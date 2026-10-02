---
id: FEAT-014
title: "Offline catch-up and fast-forward"
status: planned
importance: high
paths:
  - "apps/game/src/catchup/**"
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

Acceptance:
- Fast-forwarding a week finishes within the budget on a laptop-class device.
- The result is identical whether replayed in the browser or in the headless runner.
