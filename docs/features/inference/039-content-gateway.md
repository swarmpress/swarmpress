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
  - crates/content-model/src/article_profile.rs
  - crates/server/tests/articles.rs
  - crates/server/tests/attribution.rs
  - crates/server/tests/close.rs
  - crates/server/src/finalize.rs
  - crates/server/tests/finalise.rs
  - crates/server/src/site_knowledge.rs
  - crates/server/tests/knowledge.rs
  - apps/game/e2e/central-server.mjs
  - crates/server/src/deploys.rs
  - crates/server/tests/deploys.rs
  - crates/server/migrations/0003_deploys.sql
  - crates/server/migrations/0005_redeploy.sql
  - crates/github/src/types.rs
  - crates/github/src/fake.rs
  - crates/github/src/http.rs
  - crates/github/tests/fake_github.rs
  - crates/github/tests/http_contract.rs
  - crates/orchestrator/tests/redeploy.rs
  - crates/github/src/provenance.rs
  - crates/github/tests/content_repo.rs
  - crates/orchestrator/src/gateway.rs
  - apps/game/src/net/central.ts
  - apps/game/src/net/central.test.ts
  - apps/game/e2e/orchestrator.spec.ts
  - crates/github/src/content.rs
  - crates/github/src/api.rs
  - apps/game/src/orchestration/sweeper.ts
  - crates/server/src/app.rs
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
  - **K1 (built):** `GET /api/gateway/knowledge`, the knowledge pack of the site at the base head
    (lease; `ETag: "<sha>"`, 304 on a matching `If-None-Match`, `Cache-Control: no-cache`; 413 when
    the site is over the snapshot caps, 502 for a broken index), cached in memory per (repo, sha)
    and dropped on a merge (`crates/server/src/site_knowledge.rs`). `SWARMPRESS_FAKE_SITE` seeds the
    fake's site repos (the e2e uses the `cinqueterre-mini` fixture).
  - **G3 (built):** for `content/pages/blog/*.json`, `check_draft`
    validates the v2 schema and the article profile (`content_model::article_profile`, re-exported
    as `crates/server/src/article.rs`; the eval harness runs the same code, FEAT-036) and refuses an
    empty slug (422 with `issues`); the draft is refused with 409 when the path exists on base, when
    another open pull request of the company targets it, or when the content id already drafts
    another path. Its links and media must be in the closed world of the knowledge pack at the base
    head (`KnowledgeBase::closed_world_issues`; 422, one `<pointer>: <message>` issue each); with
    `SWARMPRESS_ARTICLE_PROFILE=off` (fake GitHub only) that check is off too. The blog index cannot
    be drafted (403). Other `content/**` pages are accepted as before.
  - **G4 (built):** finalise on merge in the same pull request: verify the reviewed head, merge
    base into the branch (`RepoApi::merge_branch`), set `status: published`, insert the blog-index
    entry as a text edit that keeps every other byte, squash-merge. An interrupted merge is resumed
    (`gateway_prs.final_head`). Pages outside the blog merge as before. The entry's shape and the
    rules are in `crates/server/README.md` ("Finalise on merge").
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
