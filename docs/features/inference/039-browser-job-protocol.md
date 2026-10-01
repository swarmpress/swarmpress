---
id: FEAT-039
title: "Browser job worker protocol"
status: planned
importance: critical
paths:
  - crates/server/src/jobs/browser.rs
  - "crates/server/tests/browser_worker*.rs"
  - apps/game/src/llm/worker-client.ts
  - apps/game/src/llm/leader.ts
  - crates/testkit/src/fake_browser_worker.rs
adrs:
  - ADR-0025
---

# Browser job worker protocol

`JobOffer → JobClaim{lease} → JobProgress → JobResult | JobFailed`; Web Locks leader election across
tabs; server-side artifact validation; lease expiry and disconnect re-queue; morning-rush drain on
reconnect.

Decisions: [ADR-0025](../../adr/0025-browser-job-worker-protocol.md).

## Acceptance criteria

- [ ] FakeBrowserWorker tests: claim, lease expiry, re-queue, invalid artifact rejection, reconnect drain.
- [ ] Exactly one tab is the worker (Playwright, multiple pages).
- [ ] The browser never receives GitHub credentials.

## Evidence

- `server/nextest`
- `game/vitest`
- `game/playwright-e2e`
