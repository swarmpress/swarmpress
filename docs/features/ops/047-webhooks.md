---
id: FEAT-047
title: "Webhooks"
status: in-progress
importance: high
paths:
  - crates/server/src/webhooks.rs
  - crates/server/tests/gateway.rs
  - crates/github/src/webhooks.rs
  - crates/server/src/deploys.rs
  - crates/server/tests/deploys.rs
  - crates/server/migrations/0003_deploys.sql
  - crates/server/migrations/0005_redeploy.sql
adrs:
  - ADR-0009
  - ADR-0061
  - ADR-0059
---

# Webhooks

`pull_request`, `check_suite`/`check_run`, `deployment_status` and `push` webhooks, HMAC-verified
and deduplicated by delivery id, turned into `ServerCommand`s.

Decisions: [ADR-0009](../../adr/0009-site-repo-canonical-github-app.md).

## MVP: deploy observation by polling (ADR-0061; increment G5)

Design: [`docs/design/mvp-pipeline.md`](../../design/mvp-pipeline.md) section 5 ("Deploy outcomes").
Reference: the "Deploy observation" section of [`crates/server/README.md`](../../../crates/server/README.md).

Built on the server (`crates/server/src/deploys.rs`, migration `0003_deploys.sql`):

- `POST /webhooks/github` verifies the HMAC, dedupes by delivery id and acts on
  `deployment_status` only; the other event types are parsed and ignored.
- A merged gateway pull request is `pending` until it is `landed` or `failed`
  (`gateway_prs.merged_at`, `landed_at`, `deploy_state`). Each pull request lands or fails once,
  whichever source reports it; the event is stored in the same transaction.
- With a real GitHub, a background task polls the check runs of every merged, unlanded commit
  (`RepoApi::list_check_runs`) and publishes `DeployLanded` / `DeployFailed` with `source: "poll"`.
  It never runs with the fake GitHub or with `SWARMPRESS_SIMULATE_DEPLOY`, and simulated deploys
  with a real GitHub are a startup error.
- A successful deployment of sha S lands every gateway pull request of that repository merged at
  or before S, for the poller and for the webhook alike.
- A failed deployment emits `DeployFailed`; so does a merge nobody deployed within
  `SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS` (`state: "timed_out"`). A failed merge lands later if a
  later deployment succeeds.
- `GET /api/gateway/deploy-status?number=` (or `?work_item=`) is the read route for the browser's
  watchdog.

Not built here: `DeployFailed` reaching the sim as a command and raising a ticket (ADR-0059, the
sim increment), and the browser's watchdog that asks `deploy-status` after its wall-clock limit.

Limits: a deployment of a commit the gateway did not merge (a push by hand) cannot be placed among
the merges, so it lands nothing by itself. The verdict rules for check runs are written against
GitHub's documented behaviour and the one real deployment seen (`build` and `deploy` check runs on
the squash commit); they have not been run against a real repository.

MVP acceptance: a burst of two merges with one deployment lands both
(`deploys::a_burst_of_two_merges_with_one_deployment_lands_both`); a failed deployment emits
`DeployFailed` (the ticket is the sim's part).

## Acceptance criteria

- [ ] Bad HMAC is rejected; duplicate delivery is a no-op.
- [ ] `deployment_status: success` produces `Cmd::DeployLanded` exactly once.

## Evidence

- `github/nextest`
- `server/nextest`
