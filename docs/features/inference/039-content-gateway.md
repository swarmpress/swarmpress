---
id: FEAT-039
title: "Content gateway and events inbox"
status: in-progress
importance: critical
paths:
  - crates/server/src/gateway.rs
  - crates/server/src/db/gateway.rs
  - crates/server/src/events.rs
  - crates/server/src/db/events.rs
  - crates/server/tests/gateway.rs
  - crates/server/tests/events.rs
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/orchestrator.spec.ts
adrs:
  - ADR-0009
  - ADR-0038
  - ADR-0045
  - ADR-0050
---

# Content gateway and events inbox

Replaces "Browser job worker protocol" (ADR-0025's server queue was retired by ADR-0038).

The browser never holds GitHub credentials. It calls `POST /api/gateway/draft` and
`/api/gateway/merge` while holding the company lease.

**PathPolicy:**
- only `content/**` JSON files on `drafts/content-{id}` branches;
- no traversal;
- a 256 KiB maximum size.

Merges and the `deployment_status` webhook produce events (`DeployLanded`, `DeployFailed`). The
browser reads them from `GET /api/events?after=` or the `/ws/events` push channel.

Planned changes:
- **Fencing (FEAT-013, ADR-0045):** the lease header becomes `<epoch>.<lease_id>`; a stale epoch
  gets 409, and the per-company mutex covers the GitHub call.
- **Server-side validation:** the draft endpoint validates the page against `content-schema`
  instead of trusting the browser.
- **Assets (FEAT-075, ADR-0050):** the draft endpoint validates media sidecars; the merge refuses
  if a referenced asset is missing and promotes staged assets before merging.
- **Quotas (FEAT-067):** 60 writes per hour and 20 merges per day per company.
