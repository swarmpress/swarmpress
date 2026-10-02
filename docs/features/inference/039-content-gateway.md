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
  - crates/server/src/article.rs
  - crates/server/tests/articles.rs
  - crates/server/tests/attribution.rs
  - crates/server/tests/close.rs
  - crates/github/src/provenance.rs
  - crates/github/tests/content_repo.rs
  - crates/orchestrator/src/gateway.rs
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
  - **G3 (built, except the closed-world half):** for `content/pages/blog/*.json`, `check_draft`
    validates the v2 schema and the article profile (`crates/server/src/article.rs`) and refuses an
    empty slug (422 with `issues`); the draft is refused with 409 when the path exists on base, when
    another open pull request of the company targets it, or when the content id already drafts
    another path. Links and media are not checked yet: `gateway::check_closed_world` takes an
    optional knowledge base and gets none until K1 lands. The blog index cannot be drafted (403).
    Other `content/**` pages are accepted as before.
  - **G4:** finalise on merge in the same pull request: verify the reviewed head, merge base into
    the branch, set `status: published`, append the blog-index entry, squash-merge.
  - **G6 (built on the server and in the gateway types; the orchestrator does not send it yet):**
    draft and merge take an optional `attribution`; the persona is the git author of draft commits
    with the platform as committer; the squash commit carries `Co-authored-by` and the trailers
    `Job`, `Job-Kind`, `Work-Item`, `Model`, `Executor`, `Reviewed-by`, `Approved-by`. The author's
    email is synthesised by the server; a malformed attribution answers 400. `Gateway::open_draft_as`
    and `merge_as` carry it in the orchestrator; `centralGateway` passes it as a trailing argument.
  - **G7 (the route is built; the day-start sweeper is not):** `POST /api/gateway/close {number}`
    closes a pull request this company opened and deletes its draft branch; lease-fenced,
    idempotent, 404 for other pull requests, 409 for merged ones; recorded as
    `gateway_prs.closed_at` (migration `0003_deploys.sql`). A closed pull request frees its path.
