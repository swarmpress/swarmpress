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
  - crates/github/src/content.rs
  - crates/github/src/api.rs
  - apps/game/src/orchestration/sweeper.ts
adrs:
  - ADR-0009
  - ADR-0038
  - ADR-0045
  - ADR-0050
  - ADR-0061
  - ADR-0058
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
- **MVP (ADR-0061; design in [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) sections
  3, 4, 7 and 8):**
  - **K1:** `GET /api/gateway/knowledge`, the knowledge pack.
  - **G3:** `check_draft` validates the v2 schema and the article profile, checks links and media
    against the site's indexes, refuses a path that exists on base or is targeted by another open
    pull request of the company, and refuses an empty slug.
  - **G4:** finalise on merge in the same pull request: verify the reviewed head, merge base into
    the branch, set `status: published`, append the blog-index entry, squash-merge.
  - **G6:** attribution fields; the persona as author of draft commits; trailers on the squash
    commit.
  - **G7:** `POST /api/gateway/close` for cancelled items, used by a day-start sweeper.
