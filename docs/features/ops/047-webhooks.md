---
id: FEAT-047
title: "Webhooks"
status: planned
importance: high
paths:
  - crates/server/src/webhooks.rs
  - crates/server/tests/gateway.rs
  - crates/github/src/webhooks.rs
  - crates/server/src/deploys.rs
  - crates/server/tests/deploys.rs
  - crates/server/migrations/0003_deploys.sql
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

What exists today: `POST /webhooks/github` verifies the HMAC, dedupes by delivery id and acts on
`deployment_status` only; the other event types are parsed and ignored. A server on localhost
receives no webhooks, and a deploy is mapped by exact merged sha, so a burst of merges strands the
earlier item. The code exists; the status stays `planned` until G5 lands with its evidence.

- A background task polls merged, unlanded gateway pull requests (check runs or deployments of the
  merged sha) and publishes `DeployLanded` / `DeployFailed` with `source: "poll"`.
- A successful deployment of sha S lands every pull request merged at or before S (`merged_at`,
  `landed_at`).
- `DeployFailed` reaches the sim as a command and raises a ticket (ADR-0059).

MVP acceptance: a burst of two merges with one deployment lands both; a failed deployment blocks
the item with a ticket.

## Acceptance criteria

- [ ] Bad HMAC is rejected; duplicate delivery is a no-op.
- [ ] `deployment_status: success` produces `Cmd::DeployLanded` exactly once.

## Evidence

- `github/nextest`
- `server/nextest`
